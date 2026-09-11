import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { loadDotEnv } from '../src/config/env';
import { createAdminDb } from '../src/db/drizzle';

loadDotEnv();

/**
 * Contrato aditivo de 0049. Las suites históricas quedan intactas; ésta prueba
 * únicamente el nuevo sujeto Recall y sus fronteras de privacidad.
 */
describe('Outbox polimórfica para Recall', () => {
  const admin = createAdminDb();
  const norte = randomUUID();
  const sur = randomUUID();
  const pacienteNorte = randomUUID();
  const pacienteSur = randomUUID();
  let recallNorte: string;
  let intentoNorte: string;

  beforeAll(async () => {
    await admin.db.execute(sql`
      INSERT INTO tenants(id,nombre_clinica,plan,subscription_status) VALUES
        (${norte}::uuid,'Recall Mensajería Norte','clinica','active'),
        (${sur}::uuid,'Recall Mensajería Sur','clinica','active')
    `);
    await admin.db.execute(sql`
      INSERT INTO booking_settings(tenant_id,slug,publicado,feature_activa) VALUES
        (${norte}::uuid,${`recall-${norte.slice(0, 8)}`},true,true),
        (${sur}::uuid,${`recall-${sur.slice(0, 8)}`},true,true)
    `);
    await admin.db.execute(sql`
      INSERT INTO patients(id,tenant_id,nombre,fecha_nacimiento,email,telefono_normalizado,
                           canal_preferido,whatsapp_opt_in_at) VALUES
        (${pacienteNorte}::uuid,${norte}::uuid,'Paciente Norte','1990-01-01',
         'norte@example.mx','+526641111111','whatsapp',now()),
        (${pacienteSur}::uuid,${sur}::uuid,'Paciente Sur','1990-01-01',
         'sur@example.mx','+526642222222','whatsapp',now())
    `);
    const tipo = ((await admin.db.execute(sql`
      INSERT INTO recall_types(tenant_id,nombre,interval_months)
      VALUES(${norte}::uuid,'Revisión',6) RETURNING id
    `)).rows[0] as { id: string }).id;
    recallNorte = ((await admin.db.execute(sql`
      INSERT INTO patient_recalls(tenant_id,patient_id,recall_type_id,source,due_date,status)
      VALUES(${norte}::uuid,${pacienteNorte}::uuid,${tipo}::uuid,'manual',current_date,'due')
      RETURNING id
    `)).rows[0] as { id: string }).id;
    intentoNorte = await crearIntento(1);
  });

  afterAll(async () => {
    await admin.db.execute(sql`DELETE FROM tenants WHERE id IN (${norte}::uuid,${sur}::uuid)`);
    await admin.pool.end();
  });

  async function crearIntento(numero: number): Promise<string> {
    return ((await admin.db.execute(sql`
      INSERT INTO recall_attempts(tenant_id,patient_recall_id,channel,attempt_number,scheduled_at)
      VALUES(${norte}::uuid,${recallNorte}::uuid,'whatsapp',${numero},now()) RETURNING id
    `)).rows[0] as { id: string }).id;
  }

  async function crearMensaje(intento: string, sufijo: string): Promise<string> {
    return ((await admin.db.execute(sql`
      INSERT INTO outbound_messages(
        tenant_id,recall_attempt_id,patient_id,channel,kind,scheduled_at,status,
        provider,idempotency_key,next_attempt_at
      ) VALUES(
        ${norte}::uuid,${intento}::uuid,${pacienteNorte}::uuid,'whatsapp','recall',now(),
        'pending','twilio',${`recall:${recallNorte}:${sufijo}:whatsapp`},now()
      ) RETURNING id
    `)).rows[0] as { id: string }).id;
  }

  it('exige exactamente una cita o un intento de recall', async () => {
    await expect(admin.db.execute(sql`
      INSERT INTO outbound_messages(
        tenant_id,patient_id,channel,kind,scheduled_at,provider,idempotency_key,next_attempt_at
      ) VALUES(${norte}::uuid,${pacienteNorte}::uuid,'email','recall',now(),'resend',${randomUUID()},now())
    `)).rejects.toThrow(/outbound_messages_sujeto_chk|outbound_messages_sujeto_check/i);

    const cita = randomUUID();
    const doctor = randomUUID();
    await admin.db.execute(sql`
      INSERT INTO users(id,tenant_id,email,password_hash,nombre,rol,es_medico)
      VALUES(${doctor}::uuid,${norte}::uuid,${`${doctor}@test.mx`},'x','Dra. Norte','admin',true)
    `);
    await admin.db.execute(sql`
      INSERT INTO appointments(id,tenant_id,patient_id,doctor_id,inicio_programado,fin_programado)
      VALUES(${cita}::uuid,${norte}::uuid,${pacienteNorte}::uuid,${doctor}::uuid,
             now()+interval '2 days',now()+interval '2 days 30 minutes')
    `);
    await expect(admin.db.execute(sql`
      INSERT INTO outbound_messages(
        tenant_id,appointment_id,recall_attempt_id,patient_id,channel,kind,scheduled_at,
        provider,idempotency_key,next_attempt_at
      ) VALUES(${norte}::uuid,${cita}::uuid,${intentoNorte}::uuid,${pacienteNorte}::uuid,
               'email','recall',now(),'resend',${randomUUID()},now())
    `)).rejects.toThrow(/outbound_messages_sujeto_chk|outbound_messages_sujeto_check/i);
  });

  it('impide enlazar el intento de otra clínica o de otro paciente', async () => {
    await expect(admin.db.execute(sql`
      INSERT INTO outbound_messages(
        tenant_id,recall_attempt_id,patient_id,channel,kind,scheduled_at,provider,
        idempotency_key,next_attempt_at
      ) VALUES(${sur}::uuid,${intentoNorte}::uuid,${pacienteSur}::uuid,'email','recall',now(),
               'resend',${randomUUID()},now())
    `)).rejects.toThrow(/recall attempt does not belong/i);
  });

  it('reclama un mensaje sin cita y devuelve la reserva pública', async () => {
    const id = await crearMensaje(intentoNorte, 'a1');
    const row = ((await admin.db.execute(sql`
      SELECT * FROM claim_outbound_messages(100)
    `)).rows as Array<Record<string, unknown>>).find((item) => item.id === id);
    expect(row).toMatchObject({
      id,
      appointment_id: null,
      recall_attempt_id: intentoNorte,
      starts_at: null,
      booking_slug: `recall-${norte.slice(0, 8)}`,
      idempotency_key: `recall:${recallNorte}:a1:whatsapp`,
    });
  });

  it('revocar WhatsApp cancela también un recall pendiente', async () => {
    const intento = await crearIntento(2);
    const id = await crearMensaje(intento, 'a2');
    await admin.db.execute(sql`
      INSERT INTO patient_consent_events(tenant_id,patient_id,tipo,accion,origen)
      VALUES(${norte}::uuid,${pacienteNorte}::uuid,'whatsapp','retirado','recepcion')
    `);
    const status = ((await admin.db.execute(sql`
      SELECT status FROM outbound_messages WHERE id=${id}::uuid
    `)).rows[0] as { status: string }).status;
    expect(status).toBe('cancelled');
  });
});
