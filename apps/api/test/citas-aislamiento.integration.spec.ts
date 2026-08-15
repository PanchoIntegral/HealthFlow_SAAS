import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import type { NotaEvolucionContent } from '@healthflow/shared-types';
import { EMPTY_NOTA_EVOLUCION } from '@healthflow/shared-types';
import { loadDotEnv, env } from '../src/config/env';
import { createAdminDb } from '../src/db/drizzle';
import { AppModule } from '../src/app.module';

loadDotEnv();

/**
 * Reporte que origina esta suite: "notas clínicas que llenaba de un paciente
 * en específico le aparecían los datos a otro paciente".
 *
 * La causa real resultó ser del FRONTEND (Next.js App Router reutiliza la
 * instancia de la página de consulta al navegar entre dos citas de la misma
 * ruta dinámica, y el estado local de la nota sobrevivía el cambio de
 * paciente — corregido forzando un remount con `key={appointmentId}`). Esta
 * suite no puede probar ESE bug —vivía en React, no en la API— pero sí puede
 * probar, contra Postgres real, que el servidor jamás sería CÓMPLICE de un
 * error así: que guardar/leer la nota de una cita nunca toca la de otra, y
 * que ningún dato de un tenant es alcanzable desde otro. Si esas dos cosas
 * son ciertas, un bug de estado en el cliente puede, cuando mucho, mostrar
 * datos viejos del MISMO médico — nunca los de un paciente ajeno a su cuenta.
 */
describe('Aislamiento de citas y notas clínicas', () => {
  const admin = createAdminDb();
  let app: INestApplication;

  // Tenant Norte: un médico, dos pacientes (Ana y Beto) — el caso que
  // reprodujo el reporte: dos citas del MISMO médico, mismo día.
  let tenantNorte: string;
  let doctorNorte: string;
  let pacienteAna: string;
  let pacienteBeto: string;
  let tokenNorte: string;

  // Tenant Sur: control cruzado — nada de esto debe ser alcanzable desde Norte.
  let tenantSur: string;
  let doctorSur: string;
  let pacienteCarla: string;
  let tokenSur: string;

  let citaAna: string;
  let citaBeto: string;
  let citaCarla: string;

  async function crearTenantConDoctor(nombreClinica: string, nombreDoctor: string) {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await admin.db.execute(sql`
      INSERT INTO tenants (id, nombre_clinica, plan, subscription_status)
      VALUES (${tenantId}::uuid, ${nombreClinica}, 'consultorio', 'active')
    `);
    await admin.db.execute(sql`
      INSERT INTO users (id, tenant_id, email, password_hash, nombre, rol, es_medico)
      VALUES (${userId}::uuid, ${tenantId}::uuid, ${`${userId}@test.mx`}, 'x', ${nombreDoctor}, 'admin', true)
    `);
    return { tenantId, userId };
  }

  async function crearPaciente(tenantId: string, nombre: string) {
    const id = randomUUID();
    await admin.db.execute(sql`
      INSERT INTO patients (id, tenant_id, nombre, fecha_nacimiento)
      VALUES (${id}::uuid, ${tenantId}::uuid, ${nombre}, '1990-01-01')
    `);
    return id;
  }

  function firmar(userId: string, tenantId: string): string {
    return app
      .get(JwtService)
      .sign({ sub: userId, tid: tenantId, rol: 'admin' }, { secret: env.jwtSecret });
  }

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  /** Agenda, hace check-in e inicia consulta: deja la cita en 'en_consulta' con nota borrador. */
  async function abrirConsulta(token: string, patientId: string, doctorId: string, offsetMin: number) {
    const inicio = new Date(Date.now() + offsetMin * 60_000);
    const fin = new Date(inicio.getTime() + 20 * 60_000);
    const { body: cita } = await request(app.getHttpServer())
      .post('/api/appointments')
      .set(auth(token))
      .send({
        patientId,
        doctorId,
        inicioProgramado: inicio.toISOString(),
        finProgramado: fin.toISOString(),
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/appointments/${cita.id}/check-in`)
      .set(auth(token))
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/appointments/${cita.id}/start-consultation`)
      .set(auth(token))
      .expect(201);

    return cita.id as string;
  }

  function nota(texto: string): NotaEvolucionContent {
    return { ...EMPTY_NOTA_EVOLUCION, padecimientoActual: texto };
  }

  beforeAll(async () => {
    const norte = await crearTenantConDoctor('Clínica Norte', 'Dra. Norte');
    tenantNorte = norte.tenantId;
    doctorNorte = norte.userId;
    const sur = await crearTenantConDoctor('Clínica Sur', 'Dr. Sur');
    tenantSur = sur.tenantId;
    doctorSur = sur.userId;

    pacienteAna = await crearPaciente(tenantNorte, 'Ana');
    pacienteBeto = await crearPaciente(tenantNorte, 'Beto');
    pacienteCarla = await crearPaciente(tenantSur, 'Carla');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    tokenNorte = firmar(doctorNorte, tenantNorte);
    tokenSur = firmar(doctorSur, tenantSur);

    // Horarios separados para el mismo médico: evita el traslape que
    // ScheduleAppointmentUseCase rechaza a propósito.
    citaAna = await abrirConsulta(tokenNorte, pacienteAna, doctorNorte, 60);
    citaBeto = await abrirConsulta(tokenNorte, pacienteBeto, doctorNorte, 120);
    citaCarla = await abrirConsulta(tokenSur, pacienteCarla, doctorSur, 60);
  });

  afterAll(async () => {
    for (const tenantId of [tenantNorte, tenantSur]) {
      await admin.db.execute(sql`DELETE FROM clinical_notes WHERE tenant_id = ${tenantId}::uuid`);
      await admin.db.execute(sql`DELETE FROM clinical_records WHERE tenant_id = ${tenantId}::uuid`);
      await admin.db.execute(sql`DELETE FROM appointments WHERE tenant_id = ${tenantId}::uuid`);
      await admin.db.execute(sql`DELETE FROM notifications WHERE tenant_id = ${tenantId}::uuid`);
      await admin.db.execute(sql`DELETE FROM audit_log WHERE tenant_id = ${tenantId}::uuid`);
      await admin.db.execute(sql`DELETE FROM patients WHERE tenant_id = ${tenantId}::uuid`);
      await admin.db.execute(sql`DELETE FROM users WHERE tenant_id = ${tenantId}::uuid`);
      await admin.db.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}::uuid`);
    }
    await app?.close();
    await admin.pool.end();
  });

  describe('mismo médico, mismo día, dos pacientes distintos', () => {
    it('guardar el borrador de Ana no se ve en la nota de Beto', async () => {
      await request(app.getHttpServer())
        .put(`/api/consultations/${citaAna}/note`)
        .set(auth(tokenNorte))
        .send({ contenido: nota('PACIENTE ANA: dolor abdominal de 2 días') })
        .expect(200);

      const { body: notaBeto } = await request(app.getHttpServer())
        .get(`/api/consultations/${citaBeto}/note`)
        .set(auth(tokenNorte))
        .expect(200);

      expect(notaBeto.contenido.padecimientoActual).not.toContain('ANA');
      expect(notaBeto.appointmentId).toBe(citaBeto);
    });

    it('guardar el borrador de Beto no pisa el de Ana', async () => {
      await request(app.getHttpServer())
        .put(`/api/consultations/${citaBeto}/note`)
        .set(auth(tokenNorte))
        .send({ contenido: nota('PACIENTE BETO: cefalea intensa') })
        .expect(200);

      const { body: notaAna } = await request(app.getHttpServer())
        .get(`/api/consultations/${citaAna}/note`)
        .set(auth(tokenNorte))
        .expect(200);

      expect(notaAna.contenido.padecimientoActual).toContain('ANA');
      expect(notaAna.contenido.padecimientoActual).not.toContain('BETO');
      expect(notaAna.appointmentId).toBe(citaAna);
    });

    it('cada GET de nota trae SIEMPRE el appointmentId que se pidió', async () => {
      const [{ body: a }, { body: b }] = await Promise.all([
        request(app.getHttpServer()).get(`/api/consultations/${citaAna}/note`).set(auth(tokenNorte)),
        request(app.getHttpServer()).get(`/api/consultations/${citaBeto}/note`).set(auth(tokenNorte)),
      ]);
      expect(a.appointmentId).toBe(citaAna);
      expect(b.appointmentId).toBe(citaBeto);
      expect(a.id).not.toBe(b.id); // notas distintas, no la misma fila servida dos veces
    });

    it('la sala de espera reporta cada cita con SU paciente, no el del vecino', async () => {
      const { body: sala } = await request(app.getHttpServer())
        .get('/api/appointments/waiting-room')
        .set(auth(tokenNorte))
        .expect(200);

      const entradaAna = sala.find((e: { appointmentId: string }) => e.appointmentId === citaAna);
      const entradaBeto = sala.find((e: { appointmentId: string }) => e.appointmentId === citaBeto);
      expect(entradaAna.patientNombre).toBe('Ana');
      expect(entradaBeto.patientNombre).toBe('Beto');
    });

    it('cancelar una cita nueva de Ana no cambia el estatus de la cita de Beto', async () => {
      const inicio = new Date(Date.now() + 180 * 60_000);
      const { body: citaExtra } = await request(app.getHttpServer())
        .post('/api/appointments')
        .set(auth(tokenNorte))
        .send({
          patientId: pacienteAna,
          doctorId: doctorNorte,
          inicioProgramado: inicio.toISOString(),
          finProgramado: new Date(inicio.getTime() + 20 * 60_000).toISOString(),
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/appointments/${citaExtra.id}/cancel`)
        .set(auth(tokenNorte))
        .send({ motivo: 'Prueba' })
        .expect(201);

      const { body: sala } = await request(app.getHttpServer())
        .get('/api/appointments/waiting-room')
        .set(auth(tokenNorte))
        .expect(200);
      const beto = sala.find((e: { appointmentId: string }) => e.appointmentId === citaBeto);
      expect(beto.estatus).toBe('en_consulta'); // intacta
    });
  });

  describe('frontera de tenant: Sur es invisible desde Norte', () => {
    it('Norte no puede leer la nota de la cita de Sur (404, no datos ajenos)', async () => {
      await request(app.getHttpServer())
        .get(`/api/consultations/${citaCarla}/note`)
        .set(auth(tokenNorte))
        .expect(404);
    });

    it('Norte no puede cancelar la cita de Sur', async () => {
      await request(app.getHttpServer())
        .post(`/api/appointments/${citaCarla}/cancel`)
        .set(auth(tokenNorte))
        .send({ motivo: 'intento cruzado' })
        .expect(404);
    });

    it('Norte no puede guardar un borrador sobre la nota de Sur', async () => {
      await request(app.getHttpServer())
        .put(`/api/consultations/${citaCarla}/note`)
        .set(auth(tokenNorte))
        .send({ contenido: nota('intento de escritura cruzada') })
        .expect(404);

      // Control positivo: Sur sigue viendo SU nota intacta.
      const { body: notaCarla } = await request(app.getHttpServer())
        .get(`/api/consultations/${citaCarla}/note`)
        .set(auth(tokenSur))
        .expect(200);
      expect(notaCarla.contenido.padecimientoActual).not.toContain('cruzada');
    });

    it('la sala de espera de Norte nunca incluye la cita de Sur', async () => {
      const { body: sala } = await request(app.getHttpServer())
        .get('/api/appointments/waiting-room')
        .set(auth(tokenNorte))
        .expect(200);
      expect(sala.some((e: { appointmentId: string }) => e.appointmentId === citaCarla)).toBe(false);
    });
  });
});
