import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { loadDotEnv } from '../src/config/env';
import { createAdminDb, createAppDb, runInTenant } from '../src/db/drizzle';
import { AppModule } from '../src/app.module';

loadDotEnv();

/**
 * P0.5 por HTTP: el formulario público rechaza datos imposibles y el
 * consentimiento se conserva como historial (un formulario nuevo jamás
 * retira un consentimiento anterior).
 */
describe('Validación estricta de la reserva pública', () => {
  const admin = createAdminDb();
  let app: INestApplication;
  let tenantId: string; let doctorId: string; let serviceId: string; let slug: string;
  let visitas = 0; let slots = 0;

  function slot(): string {
    const d = new Date(); d.setUTCDate(d.getUTCDate() + 7 + slots++); d.setUTCHours(16, 0, 0, 0);
    while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString();
  }

  function reservar(patient: Record<string, unknown>) {
    return request(app.getHttpServer()).post(`/api/public/booking/${slug}/appointments`)
      .set('X-Forwarded-For', `203.0.113.${++visitas % 254 + 1}`)
      .send({ serviceId, start: slot(), patient: { nombre: 'Ana López', fechaNacimiento: '1990-01-01', telefono: '664 123 4567', canalPreferido: 'whatsapp', whatsappOptIn: true, privacyNoticeAccepted: true, privacyNoticeVersion: '2026-01', ...patient } });
  }

  beforeAll(async () => {
    tenantId = randomUUID(); doctorId = randomUUID(); serviceId = randomUUID(); slug = `valida-${tenantId.slice(0, 8)}`;
    await admin.db.execute(sql`INSERT INTO tenants (id, nombre_clinica, plan, subscription_status) VALUES (${tenantId}::uuid, ${`Validación ${tenantId.slice(0, 8)}`}, 'consultorio', 'active')`);
    await admin.db.execute(sql`INSERT INTO users (id, tenant_id, email, password_hash, nombre, rol, es_medico) VALUES (${doctorId}::uuid, ${tenantId}::uuid, ${`${doctorId}@test.mx`}, 'x', 'Dra. Valida', 'admin', true)`);
    await admin.db.execute(sql`INSERT INTO booking_settings (tenant_id, slug, publicado, feature_activa, anticipacion_minima_horas) VALUES (${tenantId}::uuid, ${slug}, true, true, 1)`);
    await admin.db.execute(sql`INSERT INTO booking_services (id, tenant_id, nombre, duracion_minutos, publico, activo) VALUES (${serviceId}::uuid, ${tenantId}::uuid, 'Consulta', 30, true, true)`);
    await admin.db.execute(sql`INSERT INTO booking_service_doctors (tenant_id, service_id, doctor_id) VALUES (${tenantId}::uuid, ${serviceId}::uuid, ${doctorId}::uuid)`);
    for (const weekday of [1, 2, 3, 4, 5]) await admin.db.execute(sql`INSERT INTO doctor_availability (tenant_id, doctor_id, weekday, inicio_local, fin_local) VALUES (${tenantId}::uuid, ${doctorId}::uuid, ${weekday}, '08:00', '20:00')`);

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

  it('rechaza una fecha de nacimiento inexistente y una futura', async () => {
    await reservar({ fechaNacimiento: '2026-02-31' }).expect(400);
    await reservar({ fechaNacimiento: '2999-01-01' }).expect(400);
  });

  it('exige correo si el canal es correo y consentimiento si es WhatsApp', async () => {
    await reservar({ canalPreferido: 'email', whatsappOptIn: false }).expect(400);
    await reservar({ canalPreferido: 'whatsapp', whatsappOptIn: false }).expect(400);
  });

  it('rechaza teléfonos que no puede interpretar', async () => {
    await reservar({ telefono: '12345678' }).expect(400);
  });

  it('normaliza correo y teléfono, y no programa WhatsApp cuando el canal es correo', async () => {
    const res = await reservar({ telefono: '044 664 999 0000', email: '  Beto@Example.MX ', canalPreferido: 'email', whatsappOptIn: true, nombre: 'Beto Ruiz' });
    expect(res.status).toBe(201);
    expect(res.body.manageUrl).toBeDefined();
    const p = (await admin.db.execute(sql`SELECT telefono_normalizado, email, whatsapp_opt_in_at FROM patients WHERE tenant_id=${tenantId}::uuid AND nombre='Beto Ruiz'`)).rows[0] as { telefono_normalizado: string; email: string; whatsapp_opt_in_at: string | null };
    expect(p).toMatchObject({ telefono_normalizado: '+526649990000', email: 'beto@example.mx', whatsapp_opt_in_at: null });
    const canales = (await admin.db.execute(sql`SELECT DISTINCT channel FROM outbound_messages om JOIN patients p ON p.id=om.patient_id WHERE p.tenant_id=${tenantId}::uuid AND p.nombre='Beto Ruiz'`)).rows as { channel: string }[];
    expect(canales.map(c => c.channel)).toEqual(['email']);
  });

  it('un formulario posterior sin opt-in no retira el consentimiento anterior; el historial lo demuestra', async () => {
    await reservar({ nombre: 'Carla Díaz', telefono: '664 777 0000', canalPreferido: 'whatsapp', whatsappOptIn: true }).expect(201);
    await reservar({ nombre: 'Carla Díaz', telefono: '664 777 0000', canalPreferido: 'ninguno', whatsappOptIn: false }).expect(201);

    const p = (await admin.db.execute(sql`SELECT id, whatsapp_opt_in_at, canal_preferido FROM patients WHERE tenant_id=${tenantId}::uuid AND nombre='Carla Díaz'`)).rows;
    expect(p).toHaveLength(1);
    const paciente = p[0] as { id: string; whatsapp_opt_in_at: string | null; canal_preferido: string };
    expect(paciente.whatsapp_opt_in_at).not.toBeNull();
    expect(paciente.canal_preferido).toBe('ninguno');

    const eventos = (await admin.db.execute(sql`SELECT accion, origen, version_aviso FROM patient_consent_events WHERE patient_id=${paciente.id}::uuid ORDER BY created_at`)).rows;
    expect(eventos).toEqual([{ accion: 'otorgado', origen: 'reserva_publica', version_aviso: '2026-01' }]);
  });

  it('un retiro explícito cancela los WhatsApp pendientes y queda en el historial', async () => {
    await reservar({ nombre: 'Dora Paz', telefono: '664 555 0000' }).expect(201);
    const paciente = (await admin.db.execute(sql`SELECT id FROM patients WHERE tenant_id=${tenantId}::uuid AND nombre='Dora Paz'`)).rows[0] as { id: string };
    const antes = (await admin.db.execute(sql`SELECT count(*)::int n FROM outbound_messages WHERE patient_id=${paciente.id}::uuid AND channel='whatsapp' AND status='pending'`)).rows[0] as { n: number };
    expect(antes.n).toBeGreaterThan(0);

    await admin.db.execute(sql`INSERT INTO patient_consent_events(tenant_id, patient_id, tipo, accion, origen) VALUES (${tenantId}::uuid, ${paciente.id}::uuid, 'whatsapp', 'retirado', 'paciente')`);
    const despues = (await admin.db.execute(sql`SELECT count(*)::int n FROM outbound_messages WHERE patient_id=${paciente.id}::uuid AND channel='whatsapp' AND status='pending'`)).rows[0] as { n: number };
    expect(despues.n).toBe(0);
    const p = (await admin.db.execute(sql`SELECT whatsapp_opt_in_at FROM patients WHERE id=${paciente.id}::uuid`)).rows[0] as { whatsapp_opt_in_at: string | null };
    expect(p.whatsapp_opt_in_at).toBeNull();
  });

  it('rechaza un evento de consentimiento que apunta a un paciente de otra clínica', async () => {
    const otherTenantId = randomUUID();
    const otherPatientId = randomUUID();
    const appDb = createAppDb();
    await admin.db.execute(sql`INSERT INTO tenants(id,nombre_clinica,plan) VALUES(${otherTenantId}::uuid,'Clínica ajena','consultorio')`);
    await admin.db.execute(sql`INSERT INTO patients(id,tenant_id,nombre,fecha_nacimiento) VALUES(${otherPatientId}::uuid,${otherTenantId}::uuid,'Paciente ajeno','1990-01-01')`);
    try {
      await expect(runInTenant(appDb.db,tenantId,tx=>tx.execute(sql`
        INSERT INTO patient_consent_events(tenant_id,patient_id,tipo,accion,origen)
        VALUES(${tenantId}::uuid,${otherPatientId}::uuid,'whatsapp','otorgado','recepcion')
      `))).rejects.toMatchObject({code:'23503'});
      const row=(await admin.db.execute(sql`SELECT whatsapp_opt_in_at FROM patients WHERE id=${otherPatientId}::uuid`)).rows[0] as {whatsapp_opt_in_at:string|null};
      expect(row.whatsapp_opt_in_at).toBeNull();
    } finally {
      await appDb.pool.end();
      await admin.db.execute(sql`DELETE FROM tenants WHERE id=${otherTenantId}::uuid`);
    }
  });
});
