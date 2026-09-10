import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { loadDotEnv } from '../src/config/env';
import { createAdminDb, runInTenant } from '../src/db/drizzle';
import { OutboxService } from '../src/modules/messaging/outbox.service';

loadDotEnv();

/**
 * P0.1: la clave de idempotencia que guarda el outbox es la única que viaja al
 * proveedor. Esta suite fija tres garantías contra Postgres real:
 *
 *   1. 48 h y 24 h se persisten como trabajos distintos.
 *   2. `claim_outbound_messages()` devuelve la clave, y un reintento del mismo
 *      trabajo conserva exactamente la misma.
 *   3. Reprogramar A -> B -> A no pierde recordatorios: la generación
 *      (`messaging_version`) forma parte de la clave.
 */
describe('Idempotencia del outbox de mensajería', () => {
  const admin = createAdminDb();
  const outbox = new OutboxService();
  let tenantId: string;
  let doctorId: string;
  let patientId: string;

  // Cada cita recibe su propio horario para no disparar el guard de traslape del médico.
  let citas = 0;
  const horario = (n: number) => new Date(Date.now() + 5 * 86_400_000 + n * 3_600_000);

  async function crearCita(): Promise<{ id: string; inicioA: Date; inicioB: Date }> {
    const id = randomUUID();
    const inicioA = horario(citas++);
    const inicioB = new Date(inicioA.getTime() + 86_400_000);
    await admin.db.execute(sql`
      INSERT INTO appointments (id, tenant_id, patient_id, doctor_id, inicio_programado, fin_programado, estatus, origen)
      VALUES (${id}::uuid, ${tenantId}::uuid, ${patientId}::uuid, ${doctorId}::uuid, ${inicioA.toISOString()}, ${new Date(inicioA.getTime() + 30 * 60_000).toISOString()}, 'agendada', 'publico')
    `);
    return { id, inicioA, inicioB };
  }

  async function programar(appointmentId: string, startsAt: Date, kind?: 'rescheduled' | 'cancelled') {
    await runInTenant(admin.db, tenantId, tx => outbox.schedule(tx, {
      appointmentId, patientId, startsAt, email: null, phone: '+526641234567', whatsappOptIn: true,
      preferredChannel: 'whatsapp', reminderHours: [48, 24], kind,
    }));
  }

  async function filas(appointmentId: string) {
    const r = await admin.db.execute(sql`SELECT kind, status, idempotency_key FROM outbound_messages WHERE appointment_id=${appointmentId}::uuid ORDER BY created_at, idempotency_key`);
    return r.rows as { kind: string; status: string; idempotency_key: string }[];
  }

  beforeAll(async () => {
    tenantId = randomUUID(); doctorId = randomUUID(); patientId = randomUUID();
    await admin.db.execute(sql`INSERT INTO tenants (id, nombre_clinica, plan, subscription_status) VALUES (${tenantId}::uuid, ${`Idem ${tenantId.slice(0, 8)}`}, 'consultorio', 'active')`);
    await admin.db.execute(sql`INSERT INTO users (id, tenant_id, email, password_hash, nombre, rol, es_medico) VALUES (${doctorId}::uuid, ${tenantId}::uuid, ${`${doctorId}@test.mx`}, 'x', 'Dra. Idem', 'admin', true)`);
    await admin.db.execute(sql`INSERT INTO patients (id, tenant_id, nombre, fecha_nacimiento, telefono_normalizado, canal_preferido, whatsapp_opt_in_at) VALUES (${patientId}::uuid, ${tenantId}::uuid, 'Paciente Idem', '1990-01-01', '+526641234567', 'whatsapp', now())`);
  });

  afterAll(async () => {
    await admin.db.execute(sql`DELETE FROM tenants WHERE id=${tenantId}::uuid`);
    await admin.pool.end();
  });

  it('persiste confirmación, 48 h y 24 h como trabajos distintos', async () => {
    const { id: cita, inicioA } = await crearCita();
    await programar(cita, inicioA);
    const rows = await filas(cita);
    expect(rows.map(r => r.kind).sort()).toEqual(['confirmation', 'reminder', 'reminder']);
    expect(new Set(rows.map(r => r.idempotency_key)).size).toBe(3);
    expect(rows.map(r => r.idempotency_key).sort()).toEqual([
      `${cita}:v1:confirmation:whatsapp`, `${cita}:v1:reminder:24h:whatsapp`, `${cita}:v1:reminder:48h:whatsapp`,
    ]);
  });

  it('el reclamo devuelve la clave y un reintento conserva la misma', async () => {
    const { id: cita, inicioA } = await crearCita();
    await programar(cita, inicioA);
    const claim = async () => ((await admin.db.execute(sql`SELECT id, kind, idempotency_key FROM claim_outbound_messages(100)`)).rows as { id: string; kind: string; idempotency_key: string }[])
      .filter(r => r.idempotency_key.startsWith(cita));

    const primero = await claim();
    expect(primero).toHaveLength(1); // sólo la confirmación está vencida; los recordatorios son futuros
    expect(primero[0]!.idempotency_key).toBe(`${cita}:v1:confirmation:whatsapp`);

    // Simula un fallo reintentable: vuelve a quedar elegible.
    await admin.db.execute(sql`SELECT complete_outbound_message(${primero[0]!.id}::uuid, 'retryable', NULL, 'twilio_503')`);
    await admin.db.execute(sql`UPDATE outbound_messages SET next_attempt_at=now() WHERE id=${primero[0]!.id}::uuid`);
    const segundo = await claim();
    expect(segundo).toHaveLength(1);
    expect(segundo[0]!.id).toBe(primero[0]!.id);
    expect(segundo[0]!.idempotency_key).toBe(primero[0]!.idempotency_key);
  });

  it('reprogramar A -> B -> A crea recordatorios nuevos en lugar de chocar con los cancelados', async () => {
    const { id: cita, inicioA, inicioB } = await crearCita();
    await programar(cita, inicioA);

    for (const destino of [inicioB, inicioA]) {
      await runInTenant(admin.db, tenantId, async tx => {
        await outbox.cancelPending(tx, cita);
        await tx.execute(sql`UPDATE appointments SET inicio_programado=${destino.toISOString()}, fin_programado=${new Date(destino.getTime() + 30 * 60_000).toISOString()}, messaging_version=messaging_version+1 WHERE id=${cita}::uuid`);
        await outbox.schedule(tx, { appointmentId: cita, patientId, startsAt: destino, email: null, phone: '+526641234567', whatsappOptIn: true, preferredChannel: 'whatsapp', reminderHours: [48, 24], kind: 'rescheduled' });
      });
    }

    const rows = await filas(cita);
    const pendientes = rows.filter(r => r.status === 'pending');
    expect(pendientes.map(r => r.idempotency_key).sort()).toEqual([
      `${cita}:v3:reminder:24h:whatsapp`, `${cita}:v3:reminder:48h:whatsapp`, `${cita}:v3:rescheduled:whatsapp`,
    ]);
    expect(rows.filter(r => r.status === 'cancelled')).toHaveLength(6); // v1 (3) + v2 (3)
    expect(rows).toHaveLength(9);
  });
});
