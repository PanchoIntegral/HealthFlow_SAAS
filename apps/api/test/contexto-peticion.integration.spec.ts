import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { loadDotEnv, env } from '../src/config/env';
import { createAdminDb } from '../src/db/drizzle';
import { AppModule } from '../src/app.module';

loadDotEnv();

/**
 * Una ESCRITURA autenticada que llega hasta el final.
 *
 * Este archivo existe por un incidente en producción: toda escritura devolvía
 * 500 con "No hay contexto de petición", mientras las lecturas funcionaban.
 * La causa era que RequestContextInterceptor abría el AsyncLocalStorage
 * alrededor de la CONSTRUCCIÓN del observable y no de su suscripción, así que
 * el contexto se perdía en cuanto un interceptor de más adentro metía un
 * `await` antes de llamar a `next.handle()` — que es justo lo que hace
 * SuscripcionInterceptor en cada escritura.
 *
 * La suite no lo atrapó porque el test de gating manda cuerpos INVÁLIDOS a
 * propósito (distingue 402 de 400), y el 400 lo produce el ValidationPipe
 * ANTES del handler. Ninguna prueba cruzaba esa frontera. Esta sí: si el
 * contexto se pierde, este test devuelve 500 en vez de 201.
 */
describe('Contexto de petición en escrituras', () => {
  const admin = createAdminDb();
  let app: INestApplication;
  let token: string;
  let tenantId: string;
  let userId: string;
  let patientId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    userId = randomUUID();
    patientId = randomUUID();

    await admin.db.execute(sql`
      INSERT INTO tenants (id, nombre_clinica, plan, subscription_status)
      VALUES (${tenantId}::uuid, 'Clínica Contexto', 'consultorio', 'active')
    `);
    await admin.db.execute(sql`
      INSERT INTO users (id, tenant_id, email, password_hash, nombre, rol, es_medico)
      VALUES (${userId}::uuid, ${tenantId}::uuid, ${`ctx-${userId}@test.mx`},
              'x', 'Dra. Contexto', 'admin', true)
    `);
    await admin.db.execute(sql`
      INSERT INTO patients (id, tenant_id, nombre, fecha_nacimiento)
      VALUES (${patientId}::uuid, ${tenantId}::uuid, 'Paciente Contexto', '1990-01-01')
    `);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    token = app
      .get(JwtService)
      .sign({ sub: userId, tid: tenantId, rol: 'admin' }, { secret: env.jwtSecret });
  });

  afterAll(async () => {
    await admin.db.execute(sql`DELETE FROM appointments WHERE tenant_id = ${tenantId}::uuid`);
    await admin.db.execute(sql`DELETE FROM audit_log WHERE tenant_id = ${tenantId}::uuid`);
    await admin.db.execute(sql`DELETE FROM patients WHERE tenant_id = ${tenantId}::uuid`);
    await admin.db.execute(sql`DELETE FROM users WHERE tenant_id = ${tenantId}::uuid`);
    await admin.db.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}::uuid`);
    await app?.close();
    await admin.pool.end();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('agenda una cita de verdad: el tenant llega al caso de uso', async () => {
    const inicio = new Date(Date.now() + 86_400_000);
    const fin = new Date(inicio.getTime() + 30 * 60_000);

    const res = await request(app.getHttpServer())
      .post('/api/appointments')
      .set(auth())
      .send({
        patientId,
        doctorId: userId,
        inicioProgramado: inicio.toISOString(),
        finProgramado: fin.toISOString(),
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.patientNombre).toBe('Paciente Contexto');
  });

  it('la cita quedó persistida con SU tenant, no con otro ni con NULL', async () => {
    // Que responda 201 no basta: el contexto también alimenta el tenant de
    // RLS. Si se perdiera a medias, la fila podría quedar mal atribuida.
    const filas = (
      await admin.db.execute(sql`
        SELECT count(*)::int AS total FROM appointments WHERE tenant_id = ${tenantId}::uuid
      `)
    ).rows as { total: number }[];
    expect(filas[0]?.total).toBe(1);
  });

  it('deja rastro en la bitácora, que es lo que usa el contexto para el userId', async () => {
    const filas = (
      await admin.db.execute(sql`
        SELECT user_id FROM audit_log
         WHERE tenant_id = ${tenantId}::uuid AND accion = 'schedule'
      `)
    ).rows as { user_id: string }[];
    expect(filas).toHaveLength(1);
    expect(filas[0]?.user_id).toBe(userId);
  });

  it('las lecturas siguen funcionando (no se rompió el camino que sí servía)', async () => {
    await request(app.getHttpServer()).get('/api/patients').set(auth()).expect(200);
  });
});
