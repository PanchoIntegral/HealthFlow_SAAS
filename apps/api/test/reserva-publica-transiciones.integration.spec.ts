import { createHash, createHmac, randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { loadDotEnv, env } from '../src/config/env';
import { createAdminDb } from '../src/db/drizzle';
import { AppModule } from '../src/app.module';

loadDotEnv();

/**
 * P0.3 de punta a punta: las acciones públicas pasan por la máquina de
 * estados y cada efecto ocurre exactamente una vez.
 */
describe('Transiciones públicas de cita', () => {
  const admin = createAdminDb();
  let app: INestApplication;
  let tenantId: string; let doctorId: string; let serviceId: string; let patientId: string;
  let visitas = 0; let citas = 0;

  /** 10:00 local (America/Mexico_City, UTC-6) de un día hábil futuro distinto por cita. */
  function horario(offsetDays: number, hour = 16): Date {
    const d = new Date(); d.setUTCDate(d.getUTCDate() + offsetDays); d.setUTCHours(hour, 0, 0, 0);
    while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  }

  async function crearCita(opts: { estatus?: string; confirmacion?: string; startsAt?: Date; expiresAt?: Date } = {}) {
    const id = randomUUID();
    const inicio = opts.startsAt ?? horario(7 + (citas++) * 7);
    const fin = new Date(inicio.getTime() + 30 * 60_000);
    const token = createHmac('sha256', env.publicLinkSecret).update(`${tenantId}.${id}`).digest('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    await admin.db.execute(sql`INSERT INTO appointments (id, tenant_id, patient_id, doctor_id, service_id, inicio_programado, fin_programado, estatus, origen, estado_confirmacion, public_manage_token_hash, manage_token_expires_at)
      VALUES (${id}::uuid, ${tenantId}::uuid, ${patientId}::uuid, ${doctorId}::uuid, ${serviceId}::uuid, ${inicio.toISOString()}, ${fin.toISOString()}, ${opts.estatus ?? 'agendada'}, 'publico', ${opts.confirmacion ?? 'pendiente'}, ${hash}, ${(opts.expiresAt ?? new Date(fin.getTime() + 86_400_000)).toISOString()})`);
    return { id, token, inicio };
  }

  const post = (path: string, body?: unknown) => request(app.getHttpServer()).post(`/api/public/appointments/${path}`).set('X-Forwarded-For', `203.0.113.${++visitas % 254 + 1}`).send(body ?? {});

  async function eventos(id: string) {
    return ((await admin.db.execute(sql`SELECT event FROM messaging_events WHERE appointment_id=${id}::uuid AND event IN ('confirmed','cancelled','rescheduled') ORDER BY created_at`)).rows as { event: string }[]).map(x => x.event);
  }
  async function mensajes(id: string) {
    return (await admin.db.execute(sql`SELECT kind, status, idempotency_key FROM outbound_messages WHERE appointment_id=${id}::uuid ORDER BY idempotency_key`)).rows as { kind: string; status: string; idempotency_key: string }[];
  }
  async function cita(id: string) {
    return (await admin.db.execute(sql`SELECT estatus, estado_confirmacion, confirmada_at, messaging_version, inicio_programado, manage_token_expires_at FROM appointments WHERE id=${id}::uuid`)).rows[0] as { estatus: string; estado_confirmacion: string; confirmada_at: string | null; messaging_version: number; inicio_programado: string; manage_token_expires_at: string };
  }

  beforeAll(async () => {
    tenantId = randomUUID(); doctorId = randomUUID(); serviceId = randomUUID(); patientId = randomUUID();
    await admin.db.execute(sql`INSERT INTO tenants (id, nombre_clinica, plan, subscription_status) VALUES (${tenantId}::uuid, ${`Transiciones ${tenantId.slice(0, 8)}`}, 'consultorio', 'active')`);
    await admin.db.execute(sql`INSERT INTO users (id, tenant_id, email, password_hash, nombre, rol, es_medico) VALUES (${doctorId}::uuid, ${tenantId}::uuid, ${`${doctorId}@test.mx`}, 'x', 'Dra. Trans', 'admin', true)`);
    await admin.db.execute(sql`INSERT INTO booking_settings (tenant_id, slug, publicado, feature_activa, limite_cancelacion_horas, anticipacion_minima_horas, recordatorios_horas) VALUES (${tenantId}::uuid, ${`trans-${tenantId.slice(0, 8)}`}, true, true, 4, 1, '{48,24}')`);
    await admin.db.execute(sql`INSERT INTO booking_services (id, tenant_id, nombre, duracion_minutos, publico, activo) VALUES (${serviceId}::uuid, ${tenantId}::uuid, 'Consulta', 30, true, true)`);
    await admin.db.execute(sql`INSERT INTO booking_service_doctors (tenant_id, service_id, doctor_id) VALUES (${tenantId}::uuid, ${serviceId}::uuid, ${doctorId}::uuid)`);
    for (const weekday of [1, 2, 3, 4, 5]) await admin.db.execute(sql`INSERT INTO doctor_availability (tenant_id, doctor_id, weekday, inicio_local, fin_local) VALUES (${tenantId}::uuid, ${doctorId}::uuid, ${weekday}, '08:00', '20:00')`);
    await admin.db.execute(sql`INSERT INTO patients (id, tenant_id, nombre, fecha_nacimiento, telefono_normalizado, canal_preferido, whatsapp_opt_in_at) VALUES (${patientId}::uuid, ${tenantId}::uuid, 'Paciente Trans', '1990-01-01', '+526641234567', 'whatsapp', now())`);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await admin.db.execute(sql`DELETE FROM tenants WHERE id=${tenantId}::uuid`);
    await admin.pool.end();
  });

  it('confirmar dos veces registra un solo evento y conserva la primera hora de confirmación', async () => {
    const { id, token } = await crearCita();
    const a = await post(`${token}/confirm`).expect(201);
    expect(a.body.confirmationStatus).toBe('confirmada');
    const primera = (await cita(id)).confirmada_at;
    const b = await post(`${token}/confirm`).expect(201);
    expect(b.body.confirmationStatus).toBe('confirmada');
    expect(await eventos(id)).toEqual(['confirmed']);
    expect((await cita(id)).confirmada_at).toBe(primera);
  });

  it('dos confirmaciones concurrentes producen un solo evento', async () => {
    const {id,token}=await crearCita();
    const [a,b]=await Promise.all([post(`${token}/confirm`),post(`${token}/confirm`)]);
    expect([a.status,b.status]).toEqual([201,201]);
    expect(await eventos(id)).toEqual(['confirmed']);
  });

  it('cancelar dos veces programa un solo aviso y un solo evento', async () => {
    const { id, token } = await crearCita();
    await post(`${token}/cancel`).expect(201);
    await post(`${token}/cancel`).expect(201);
    expect(await eventos(id)).toEqual(['cancelled']);
    expect((await mensajes(id)).filter(m => m.kind === 'cancelled')).toHaveLength(1);
    expect((await cita(id)).estatus).toBe('cancelada');
  });

  it('dos cancelaciones concurrentes producen un solo aviso y un solo evento', async () => {
    const {id,token}=await crearCita();
    const [a,b]=await Promise.all([post(`${token}/cancel`),post(`${token}/cancel`)]);
    expect([a.status,b.status]).toEqual([201,201]);
    expect(await eventos(id)).toEqual(['cancelled']);
    expect((await mensajes(id)).filter(m=>m.kind==='cancelled')).toHaveLength(1);
  });

  it('una cita cancelada no se puede confirmar ni reprogramar', async () => {
    const { token, inicio } = await crearCita({ estatus: 'cancelada', confirmacion: 'cancelada' });
    await post(`${token}/confirm`).expect(409);
    await post(`${token}/reschedule`, { start: new Date(inicio.getTime() + 86_400_000).toISOString() }).expect(409);
  });

  it('ofrece slots reales para reprogramar y muestra libre el horario de la propia cita',async()=>{
    const {token,inicio}=await crearCita();
    const from=new Date(inicio);from.setUTCHours(6,0,0,0);
    const to=new Date(from);to.setUTCDate(to.getUTCDate()+1);
    const response=await request(app.getHttpServer())
      .get(`/api/public/appointments/${token}/availability`)
      .query({from:from.toISOString(),to:to.toISOString()})
      .set('X-Forwarded-For',`203.0.113.${++visitas%254+1}`)
      .expect(200);
    expect(response.body.some((slot:{start:string})=>slot.start===inicio.toISOString())).toBe(true);
    expect(response.body.every((slot:Record<string,unknown>)=>Object.keys(slot).sort().join(',')==='doctorId,doctorName,end,start')).toBe(true);
  });

  it.each([['finalizada', -7], ['no_asistio', -14], ['en_consulta', -21]] as const)('una cita %s no admite ninguna acción pública', async (estatus, dias) => {
    // Citas pasadas cuyo enlace sigue vigente: el rechazo debe venir del estado, no del token.
    const { token, inicio } = await crearCita({ estatus, startsAt: horario(dias), expiresAt: new Date(Date.now() + 86_400_000) });
    await post(`${token}/confirm`).expect(409);
    await post(`${token}/cancel`).expect(409);
    await post(`${token}/reschedule`, { start: new Date(inicio.getTime() + 86_400_000).toISOString() }).expect(409);
  });

  it('reprogramar reconstruye los mensajes exactamente una vez, vuelve a pendiente y extiende el token', async () => {
    const { id, token, inicio } = await crearCita({ confirmacion: 'confirmada' });
    const antes = await cita(id);
    const destino = new Date(inicio.getTime() + 2 * 3_600_000); // mismo día, 12:00 local
    const res = await post(`${token}/reschedule`, { start: destino.toISOString() }).expect(201);
    expect(res.body.confirmationStatus).toBe('pendiente');
    expect(new Date(res.body.start).toISOString()).toBe(destino.toISOString());

    const despues = await cita(id);
    expect(despues.messaging_version).toBe(antes.messaging_version + 1);
    expect(despues.confirmada_at).toBeNull();
    expect(new Date(despues.manage_token_expires_at).getTime()).toBeGreaterThan(destino.getTime());
    expect(await eventos(id)).toEqual(['rescheduled']);
    const nuevos = (await mensajes(id)).filter(m => m.status === 'pending');
    expect(nuevos.map(m => m.kind).sort()).toEqual(['reminder', 'reminder', 'rescheduled']);
    expect(nuevos.every(m => m.idempotency_key.includes(':v2:'))).toBe(true);
  });

  it('dos reprogramaciones concurrentes al mismo slot crean una sola generación', async () => {
    const {id,token,inicio}=await crearCita();
    const destino=new Date(inicio.getTime()+2*3_600_000).toISOString();
    const [a,b]=await Promise.all([
      post(`${token}/reschedule`,{start:destino}),
      post(`${token}/reschedule`,{start:destino}),
    ]);
    expect([a.status,b.status]).toEqual([201,201]);
    expect((await cita(id)).messaging_version).toBe(2);
    expect(await eventos(id)).toEqual(['rescheduled']);
  });

  it('dentro del límite de cancelación se rechaza con 403 sin tocar la cita', async () => {
    const { id, token } = await crearCita({ startsAt: new Date(Date.now() + 2 * 3_600_000) });
    await post(`${token}/cancel`).expect(403);
    expect((await cita(id)).estatus).toBe('agendada');
    expect(await eventos(id)).toEqual([]);
  });

  it('un token vencido no revela la cita', async () => {
    const { token } = await crearCita({ expiresAt: new Date(Date.now() - 60_000) });
    await post(`${token}/confirm`).expect(404);
    await request(app.getHttpServer()).get(`/api/public/appointments/${token}`).set('X-Forwarded-For', '203.0.113.250').expect(404);
  });
});
