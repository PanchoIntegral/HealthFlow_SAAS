import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { loadDotEnv, env } from '../src/config/env';
import { schema } from '../src/db/schema';
import { createAdminDb, runInTenant, type Database } from '../src/db/drizzle';
import { AppModule } from '../src/app.module';
import { DB } from '../src/db/drizzle.module';
import { AppEventsDispatcher } from '../src/common/events/app-events.dispatcher';

loadDotEnv();

/**
 * Los consumidores despachados con el ROL REAL del worker.
 *
 * Existe por un fallo que ninguna otra suite podía ver: todas usaban
 * `createAppDb` (rol `healthflow_app`, con permisos amplios), mientras que en
 * producción `worker.ts` reemplaza DATABASE_URL por WORKER_DATABASE_URL y los
 * consumidores corren como `healthflow_worker`. Ese rol no tenía INSERT sobre
 * `audit_log` ni permiso alguno sobre `outbound_messages`, así que cada
 * consumidor moría en su primera escritura transversal, agotaba los ocho
 * reintentos y quedaba `dead`. El módulo no habría funcionado en producción y
 * el síntoma habría sido "no pasa nada".
 *
 * La regla que deja este archivo: si algo lo va a ejecutar el worker, se
 * prueba con la conexión del worker.
 */
describe('Consumidores de Recall con el rol del worker', () => {
  const admin = createAdminDb();
  let workerPool: Pool;
  let workerDb: Database;
  let app: INestApplication;
  let dispatcher: AppEventsDispatcher;

  const tenant = randomUUID();
  const doctor = randomUUID();
  const paciente = randomUUID();
  let servicio: string;
  let tipo: string;
  let partida: string;

  beforeAll(async () => {
    // La conexión del worker, igual que la arma `env.workerDatabaseUrl`.
    workerPool = new Pool({ connectionString: env.workerDatabaseUrl });
    workerDb = drizzle(workerPool, { schema });

    await admin.db.execute(sql`
      INSERT INTO tenants (id, nombre_clinica, plan, subscription_status)
      VALUES (${tenant}::uuid, 'Worker Recall', 'clinica', 'active')
    `);
    await admin.db.execute(sql`
      INSERT INTO tenant_feature_flags (tenant_id, flag, habilitado, habilitado_at)
      VALUES (${tenant}::uuid, 'dental_recalls', true, now())
    `);
    await admin.db.execute(sql`
      INSERT INTO booking_settings (tenant_id, slug, timezone)
      VALUES (${tenant}::uuid, ${`worker-${tenant.slice(0, 8)}`}, 'America/Mexico_City')
    `);
    await admin.db.execute(sql`
      INSERT INTO users (id, tenant_id, email, password_hash, nombre, rol, es_medico)
      VALUES (${doctor}::uuid, ${tenant}::uuid, ${`wk-${doctor}@test.mx`}, 'x', 'Dr. Worker', 'admin', true)
    `);
    await admin.db.execute(sql`
      INSERT INTO patients (id, tenant_id, nombre, fecha_nacimiento, email, canal_preferido)
      VALUES (${paciente}::uuid, ${tenant}::uuid, 'Paciente Worker', '1990-01-01', 'pw@correo.mx', 'email')
    `);
    servicio = (
      (await admin.db.execute(sql`
        INSERT INTO booking_services (tenant_id, nombre, duracion_minutos)
        VALUES (${tenant}::uuid, 'Limpieza', 30) RETURNING id
      `)).rows[0] as unknown as { id: string }
    ).id;
    tipo = (
      (await admin.db.execute(sql`
        INSERT INTO recall_types (tenant_id, nombre, interval_months, booking_service_id)
        VALUES (${tenant}::uuid, 'Limpieza', 6, ${servicio}::uuid) RETURNING id
      `)).rows[0] as unknown as { id: string }
    ).id;
    const presupuesto = randomUUID();
    await admin.db.execute(sql`
      INSERT INTO presupuestos (id, tenant_id, patient_id, doctor_id, titulo, estatus)
      VALUES (${presupuesto}::uuid, ${tenant}::uuid, ${paciente}::uuid, ${doctor}::uuid, 'Plan', 'borrador')
    `);
    partida = (
      (await admin.db.execute(sql`
        INSERT INTO presupuesto_partidas
          (tenant_id, presupuesto_id, descripcion, piezas, fase, cantidad,
           valor_unitario_centavos, estatus, recall_type_id, orden)
        VALUES (${tenant}::uuid, ${presupuesto}::uuid, 'Limpieza', '{}', 1, 1, 50000,
                'terminado', ${tipo}::uuid, 0)
        RETURNING id
      `)).rows[0] as unknown as { id: string }
    ).id;

    // El despachador, pero con la conexión del WORKER en lugar de la de la app.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DB)
      .useValue(workerDb)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dispatcher = app.get(AppEventsDispatcher);
  });

  afterAll(async () => {
    await admin.db.execute(sql`DELETE FROM app_event_consumptions WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM app_events WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM outbound_messages WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM recall_attempts WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM patient_recalls WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM presupuesto_partidas WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM presupuestos WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM recall_types WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM appointments WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM booking_services WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM booking_settings WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM audit_log WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM patients WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM users WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM tenant_feature_flags WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM tenants WHERE id=${tenant}::uuid`);
    await app?.close();
    await admin.pool.end();
    await workerPool.end();
  });

  /** Emite como lo haría la API (rol admin, para no depender de sus permisos). */
  async function emitir(tipoEvento: string, entidadId: string, payload: object) {
    await admin.db.execute(sql`
      INSERT INTO app_events (tenant_id, tipo, entidad, entidad_id, payload)
      VALUES (${tenant}::uuid, ${tipoEvento}, 'appointment', ${entidadId}::uuid,
              ${JSON.stringify(payload)}::jsonb)
    `);
  }

  const consumos = async () =>
    (
      await admin.db.execute(sql`
        SELECT c.consumer, c.status, c.attempts, c.last_error_code
          FROM app_event_consumptions c
         WHERE c.tenant_id=${tenant}::uuid ORDER BY c.updated_at
      `)
    ).rows as unknown as { consumer: string; status: string; attempts: number; last_error_code: string | null }[];

  it('el rol del worker es realmente el del worker, no el de la aplicación', async () => {
    const quien = (await workerDb.execute(sql`SELECT current_user AS u`)).rows[0] as unknown as {
      u: string;
    };
    expect(quien.u).toBe('healthflow_worker');
  });

  it('crea el control y ESCRIBE SU AUDITORÍA con el rol del worker', async () => {
    await admin.db.execute(sql`
      INSERT INTO app_events (tenant_id, tipo, entidad, entidad_id, payload)
      VALUES (${tenant}::uuid, 'treatment_item.completed', 'presupuesto_partida',
              ${partida}::uuid, ${JSON.stringify({ patientId: paciente, doctorId: doctor })}::jsonb)
    `);
    await dispatcher.tick();

    const control = (
      await admin.db.execute(sql`
        SELECT id, status FROM patient_recalls WHERE tenant_id=${tenant}::uuid
      `)
    ).rows[0] as unknown as { id: string; status: string } | undefined;
    expect(control).toBeDefined();

    // Lo que fallaba antes: el INSERT en audit_log con user_id NULL.
    const bitacora = (
      await admin.db.execute(sql`
        SELECT user_id, detalle FROM audit_log
         WHERE tenant_id=${tenant}::uuid AND entidad='PatientRecall'
      `)
    ).rows as unknown as { user_id: string | null; detalle: Record<string, unknown> }[];
    expect(bitacora).toHaveLength(1);
    expect(bitacora[0]?.user_id).toBeNull();
    expect(bitacora[0]?.detalle).toMatchObject({ origen: 'worker' });

    expect((await consumos()).every((c) => c.status === 'done')).toBe(true);
  });

  it('cancela los mensajes en cola al vincular una cita, sin UPDATE sobre la outbox', async () => {
    const control = (
      await admin.db.execute(sql`
        SELECT id FROM patient_recalls WHERE tenant_id=${tenant}::uuid LIMIT 1
      `)
    ).rows[0] as unknown as { id: string };

    // Una gestión con su mensaje en cola, montada con el rol admin.
    const intento = (
      (await admin.db.execute(sql`
        INSERT INTO recall_attempts (tenant_id, patient_recall_id, channel, attempt_number,
                                     status, scheduled_at)
        VALUES (${tenant}::uuid, ${control.id}::uuid, 'email', 1, 'pending', now())
        RETURNING id
      `)).rows[0] as unknown as { id: string }
    ).id;
    await admin.db.execute(sql`
      INSERT INTO outbound_messages (tenant_id, recall_attempt_id, patient_id, channel, kind,
                                     scheduled_at, status, provider, idempotency_key, next_attempt_at)
      VALUES (${tenant}::uuid, ${intento}::uuid, ${paciente}::uuid, 'email', 'recall',
              now(), 'pending', 'resend', ${`wk-${intento}`}, now())
    `);

    const cita = (
      (await admin.db.execute(sql`
        INSERT INTO appointments (tenant_id, patient_id, doctor_id, service_id,
                                  inicio_programado, fin_programado, estatus)
        VALUES (${tenant}::uuid, ${paciente}::uuid, ${doctor}::uuid, ${servicio}::uuid,
                now() + interval '8 days', now() + interval '8 days 30 minutes', 'agendada')
        RETURNING id
      `)).rows[0] as unknown as { id: string }
    ).id;
    await emitir('appointment.scheduled', cita, {
      patientId: paciente,
      doctorId: doctor,
      serviceId: servicio,
    });
    await dispatcher.tick();

    const mensaje = (
      await admin.db.execute(sql`
        SELECT status FROM outbound_messages WHERE recall_attempt_id=${intento}::uuid
      `)
    ).rows[0] as unknown as { status: string };
    expect(mensaje.status).toBe('cancelled');

    const vinculado = (
      await admin.db.execute(sql`
        SELECT status, appointment_id FROM patient_recalls WHERE id=${control.id}::uuid
      `)
    ).rows[0] as unknown as { status: string; appointment_id: string };
    expect(vinculado).toMatchObject({ status: 'scheduled', appointment_id: cita });
    expect((await consumos()).some((c) => c.status === 'dead' || c.status === 'failed')).toBe(false);
  });

  it('el worker NO puede reescribir la outbox por su cuenta', async () => {
    // La función acotada es lo único que se le concedió; el UPDATE general
    // le permitiría marcar como enviado algo que nunca salió.
    await expect(
      runInTenant(workerDb, tenant, (tx) =>
        tx.execute(sql`UPDATE outbound_messages SET status='sent' WHERE tenant_id=${tenant}::uuid`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('el worker tampoco puede leer ni corregir la bitácora: sólo escribir entradas', async () => {
    await expect(
      runInTenant(workerDb, tenant, (tx) => tx.execute(sql`SELECT * FROM audit_log LIMIT 1`)),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      runInTenant(workerDb, tenant, (tx) =>
        tx.execute(sql`UPDATE audit_log SET accion='x' WHERE tenant_id=${tenant}::uuid`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('un evento con payload incompleto se hace VISIBLE en vez de desaparecer', async () => {
    // Antes esto era un `return` silencioso: la consumición quedaba 'done' y
    // el control no se creaba. Ahora falla y acaba en 'dead', que es lo que
    // vigilan las alertas del módulo.
    const cita = (
      (await admin.db.execute(sql`
        INSERT INTO appointments (tenant_id, patient_id, doctor_id, service_id,
                                  inicio_programado, fin_programado, estatus)
        VALUES (${tenant}::uuid, ${paciente}::uuid, ${doctor}::uuid, ${servicio}::uuid,
                now() + interval '9 days', now() + interval '9 days 30 minutes', 'agendada')
        RETURNING id
      `)).rows[0] as unknown as { id: string }
    ).id;
    await emitir('appointment.scheduled', cita, { doctorId: doctor }); // sin patientId
    await dispatcher.tick();

    const consumo = (
      await admin.db.execute(sql`
        SELECT c.status, c.last_error_code FROM app_event_consumptions c
          JOIN app_events e ON e.id = c.event_id
         WHERE e.entidad_id=${cita}::uuid AND c.consumer='recalls.vincular.cita.v1'
      `)
    ).rows[0] as unknown as { status: string; last_error_code: string };
    expect(consumo.status).toBe('failed');
    // El código se recorta a 80 caracteres, así que lo accionable va al frente.
    expect(consumo.last_error_code).toContain('patientId');
    expect(consumo.last_error_code).toContain('appointment.scheduled');
  });
});
