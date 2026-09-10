import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { loadDotEnv } from '../src/config/env';
import { createAdminDb, runInTenant } from '../src/db/drizzle';
import { OutboxService } from '../src/modules/messaging/outbox.service';

loadDotEnv();

/**
 * P0.2 contra Postgres real. Garantías:
 *   1. Un webhook repetido produce un solo efecto.
 *   2. Un webhook que llega antes de que el worker guarde el id del proveedor
 *      queda pendiente y se aplica al cerrar el intento.
 *   3. Un resultado incierto o un lock vencido no se reenvían solos.
 *   4. Un `undelivered` permanente cierra el mensaje; uno transitorio reintenta.
 *   5. Un rebote o queja suprime el correo del paciente y cancela lo pendiente.
 */
describe('Webhooks y entregas ambiguas de mensajería', () => {
  const admin = createAdminDb();
  const outbox = new OutboxService();
  let tenantId: string; let doctorId: string;
  let citas = 0;

  async function paciente(canal: 'whatsapp' | 'email') {
    const id = randomUUID();
    await admin.db.execute(sql`INSERT INTO patients (id, tenant_id, nombre, fecha_nacimiento, telefono_normalizado, email, canal_preferido, whatsapp_opt_in_at)
      VALUES (${id}::uuid, ${tenantId}::uuid, 'Paciente Hook', '1990-01-01', '+526641234567', ${`${id}@example.mx`}, ${canal}, now())`);
    return id;
  }

  /** Crea cita + confirmación vencida (lista para reclamar) y la reclama. Devuelve el id del mensaje en `processing`. */
  async function mensajeEnVuelo(canal: 'whatsapp' | 'email') {
    const patientId = await paciente(canal);
    const citaId = randomUUID();
    const inicio = new Date(Date.now() + 10 * 86_400_000 + (citas++) * 3_600_000);
    await admin.db.execute(sql`INSERT INTO appointments (id, tenant_id, patient_id, doctor_id, inicio_programado, fin_programado, estatus, origen)
      VALUES (${citaId}::uuid, ${tenantId}::uuid, ${patientId}::uuid, ${doctorId}::uuid, ${inicio.toISOString()}, ${new Date(inicio.getTime() + 30 * 60_000).toISOString()}, 'agendada', 'publico')`);
    await runInTenant(admin.db, tenantId, tx => outbox.schedule(tx, {
      appointmentId: citaId, patientId, startsAt: inicio, email: canal === 'email' ? `${patientId}@example.mx` : null,
      phone: '+526641234567', whatsappOptIn: true, preferredChannel: canal, reminderHours: [48], kind: undefined,
    }));
    const claimed = ((await admin.db.execute(sql`SELECT id, idempotency_key FROM claim_outbound_messages(100)`)).rows as { id: string; idempotency_key: string }[])
      .find(r => r.idempotency_key === `${citaId}:v1:confirmation:${canal}`);
    expect(claimed).toBeDefined();
    return { messageId: claimed!.id, patientId, citaId };
  }

  async function estado(messageId: string) {
    const r = await admin.db.execute(sql`SELECT status, provider_message_id, last_error_code, next_attempt_at FROM outbound_messages WHERE id=${messageId}::uuid`);
    return r.rows[0] as { status: string; provider_message_id: string | null; last_error_code: string | null; next_attempt_at: string };
  }

  async function eventos(messageId: string) {
    const r = await admin.db.execute(sql`SELECT event FROM messaging_events WHERE message_id=${messageId}::uuid ORDER BY created_at`);
    return (r.rows as { event: string }[]).map(x => x.event);
  }

  const hook = (provider: string, externalId: string, providerMessageId: string, status: string, payload: Record<string, string> = {}) =>
    admin.db.execute(sql`SELECT process_messaging_status(${provider}, ${externalId}, ${providerMessageId}, ${status}, ${JSON.stringify(payload)}::jsonb) AS ok`);

  beforeAll(async () => {
    tenantId = randomUUID(); doctorId = randomUUID();
    await admin.db.execute(sql`INSERT INTO tenants (id, nombre_clinica, plan, subscription_status) VALUES (${tenantId}::uuid, ${`Hooks ${tenantId.slice(0, 8)}`}, 'consultorio', 'active')`);
    await admin.db.execute(sql`INSERT INTO users (id, tenant_id, email, password_hash, nombre, rol, es_medico) VALUES (${doctorId}::uuid, ${tenantId}::uuid, ${`${doctorId}@test.mx`}, 'x', 'Dra. Hook', 'admin', true)`);
  });

  afterAll(async () => {
    await admin.db.execute(sql`DELETE FROM tenants WHERE id=${tenantId}::uuid`);
    await admin.pool.end();
  });

  it('un webhook repetido produce un solo efecto', async () => {
    const { messageId } = await mensajeEnVuelo('whatsapp');
    const sid = `SM${randomUUID().replace(/-/g, '')}`;
    await admin.db.execute(sql`SELECT complete_outbound_message(${messageId}::uuid, 'accepted', ${sid}, NULL)`);
    const first = (await hook('twilio', `${sid}:delivered`, sid, 'delivered')).rows[0] as { ok: boolean };
    const second = (await hook('twilio', `${sid}:delivered`, sid, 'delivered')).rows[0] as { ok: boolean };
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect((await estado(messageId)).status).toBe('delivered');
    expect(await eventos(messageId)).toEqual(['sent', 'delivered']);
  });

  it('un webhook que llega antes que el id del proveedor queda pendiente y se aplica después', async () => {
    const { messageId } = await mensajeEnVuelo('whatsapp');
    const sid = `SM${randomUUID().replace(/-/g, '')}`;
    await hook('twilio', `${sid}:delivered`, sid, 'delivered');
    const pendiente = (await admin.db.execute(sql`SELECT state FROM messaging_webhook_events WHERE provider='twilio' AND external_id=${`${sid}:delivered`}`)).rows[0] as { state: string };
    expect(pendiente.state).toBe('pending');
    expect((await estado(messageId)).status).toBe('processing');

    await admin.db.execute(sql`SELECT complete_outbound_message(${messageId}::uuid, 'accepted', ${sid}, NULL)`);
    expect((await estado(messageId)).status).toBe('delivered');
    const procesado = (await admin.db.execute(sql`SELECT state FROM messaging_webhook_events WHERE provider='twilio' AND external_id=${`${sid}:delivered`}`)).rows[0] as { state: string };
    expect(procesado.state).toBe('processed');
    expect(await eventos(messageId)).toEqual(['sent', 'delivered']);
  });

  it('un resultado incierto no vuelve a reclamarse', async () => {
    const { messageId } = await mensajeEnVuelo('whatsapp');
    await admin.db.execute(sql`SELECT complete_outbound_message(${messageId}::uuid, 'uncertain', NULL, 'net_TimeoutError')`);
    expect(await estado(messageId)).toMatchObject({ status: 'uncertain', last_error_code: 'net_TimeoutError' });
    const claimed = (await admin.db.execute(sql`SELECT id FROM claim_outbound_messages(100)`)).rows as { id: string }[];
    expect(claimed.some(r => r.id === messageId)).toBe(false);
    expect(await eventos(messageId)).toEqual(['uncertain']);
  });

  it('un lock vencido pasa a incierto en lugar de reenviarse', async () => {
    const { messageId } = await mensajeEnVuelo('whatsapp');
    await admin.db.execute(sql`UPDATE outbound_messages SET locked_at=now()-interval '11 minutes' WHERE id=${messageId}::uuid`);
    const claimed = (await admin.db.execute(sql`SELECT id FROM claim_outbound_messages(100)`)).rows as { id: string }[];
    expect(claimed.some(r => r.id === messageId)).toBe(false);
    expect(await estado(messageId)).toMatchObject({ status: 'uncertain', last_error_code: 'lock_expired' });
  });

  it('un rechazo permanente cierra el mensaje; uno transitorio programa reintento', async () => {
    const a = await mensajeEnVuelo('whatsapp');
    await admin.db.execute(sql`SELECT complete_outbound_message(${a.messageId}::uuid, 'permanent', NULL, 'twilio_21211')`);
    expect(await estado(a.messageId)).toMatchObject({ status: 'dead', last_error_code: 'twilio_21211' });

    const b = await mensajeEnVuelo('whatsapp');
    await admin.db.execute(sql`SELECT complete_outbound_message(${b.messageId}::uuid, 'retryable', NULL, 'twilio_503')`);
    expect((await estado(b.messageId)).status).toBe('failed');
  });

  it('un undelivered permanente por webhook no reintenta; uno transitorio sí', async () => {
    const a = await mensajeEnVuelo('whatsapp');
    const sidA = `SM${randomUUID().replace(/-/g, '')}`;
    await admin.db.execute(sql`SELECT complete_outbound_message(${a.messageId}::uuid, 'accepted', ${sidA}, NULL)`);
    await hook('twilio', `${sidA}:undelivered`, sidA, 'undelivered', { errorCode: '63016' });
    expect(await estado(a.messageId)).toMatchObject({ status: 'dead', last_error_code: '63016' });

    const b = await mensajeEnVuelo('whatsapp');
    const sidB = `SM${randomUUID().replace(/-/g, '')}`;
    await admin.db.execute(sql`SELECT complete_outbound_message(${b.messageId}::uuid, 'accepted', ${sidB}, NULL)`);
    await hook('twilio', `${sidB}:undelivered`, sidB, 'undelivered', { errorCode: '30001' });
    expect(await estado(b.messageId)).toMatchObject({ status: 'failed', last_error_code: '30001' });
  });

  it('un rebote suprime el correo del paciente y cancela sus correos pendientes', async () => {
    const { messageId, patientId, citaId } = await mensajeEnVuelo('email');
    const emailId = randomUUID();
    await admin.db.execute(sql`SELECT complete_outbound_message(${messageId}::uuid, 'accepted', ${emailId}, NULL)`);
    await hook('resend', `evt_${emailId}`, emailId, 'bounced', { type: 'email.bounced' });
    expect((await estado(messageId)).status).toBe('bounced');
    const p = (await admin.db.execute(sql`SELECT email_suppressed_at FROM patients WHERE id=${patientId}::uuid`)).rows[0] as { email_suppressed_at: string | null };
    expect(p.email_suppressed_at).not.toBeNull();
    const reminder = (await admin.db.execute(sql`SELECT status FROM outbound_messages WHERE appointment_id=${citaId}::uuid AND kind='reminder'`)).rows[0] as { status: string };
    expect(reminder.status).toBe('cancelled');
  });

  it('un webhook informativo (read/queued) no altera el estado', async () => {
    const { messageId } = await mensajeEnVuelo('whatsapp');
    const sid = `SM${randomUUID().replace(/-/g, '')}`;
    await admin.db.execute(sql`SELECT complete_outbound_message(${messageId}::uuid, 'accepted', ${sid}, NULL)`);
    await hook('twilio', `${sid}:read`, sid, 'read');
    expect((await estado(messageId)).status).toBe('sent');
    const st = (await admin.db.execute(sql`SELECT state FROM messaging_webhook_events WHERE provider='twilio' AND external_id=${`${sid}:read`}`)).rows[0] as { state: string };
    expect(st.state).toBe('ignored');
  });
});
