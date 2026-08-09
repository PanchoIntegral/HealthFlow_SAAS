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
 * Verifica de punta a punta la suspensión por impago: que una clínica vencida
 * pueda CONSULTAR pero no ESCRIBIR, y que al pagar el acceso vuelva solo.
 *
 * Truco para no depender de los DTO de cada módulo: el interceptor de gating
 * corre ANTES del ValidationPipe (guards → interceptores → pipes), así que un
 * POST con cuerpo inválido devuelve 402 si el gate bloqueó, y 400 si lo dejó
 * pasar. El 400 es entonces la señal de "la suscripción no fue el problema".
 */
describe('Gating de suscripción (solo lectura por impago)', () => {
  const admin = createAdminDb();
  let app: INestApplication;
  let token: string;
  let tenantId: string;
  let userId: string;

  const comoTenant = (status: string, graceUntil: string | null) =>
    admin.db.execute(sql`
      UPDATE tenants
         SET subscription_status = ${status},
             grace_until = ${graceUntil}::timestamptz
       WHERE id = ${tenantId}::uuid
    `);

  beforeAll(async () => {
    tenantId = randomUUID();
    userId = randomUUID();

    await admin.db.execute(sql`
      INSERT INTO tenants (id, nombre_clinica, plan, subscription_status)
      VALUES (${tenantId}::uuid, 'Clínica de Prueba Gating', 'consultorio', 'active')
    `);
    await admin.db.execute(sql`
      INSERT INTO users (id, tenant_id, email, password_hash, nombre, rol, es_medico)
      VALUES (${userId}::uuid, ${tenantId}::uuid, ${`gating-${userId}@test.mx`},
              'x', 'Dra. Gating', 'admin', true)
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
    await admin.db.execute(sql`DELETE FROM users WHERE tenant_id = ${tenantId}::uuid`);
    await admin.db.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}::uuid`);
    await app?.close();
    await admin.pool.end();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const ayer = new Date(Date.now() - 86_400_000).toISOString();
  const manana = new Date(Date.now() + 86_400_000).toISOString();

  describe('suscripción vencida (past_due con la gracia agotada)', () => {
    beforeAll(() => comoTenant('past_due', ayer));

    it('DEJA consultar: el expediente sigue accesible', async () => {
      // Lo importante del diseño: cortarle a un médico el acceso a los datos
      // de sus pacientes por cobranza es un riesgo clínico que no compensa.
      await request(app.getHttpServer()).get('/api/patients').set(auth()).expect(200);
    });

    it('BLOQUEA escribir, con 402 y un código que el frontend distingue', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/patients')
        .set(auth())
        .send({ nombre: 'Paciente Nuevo' })
        .expect(402);

      expect(res.body.error).toBe('SuscripcionSuspendida');
      expect(res.body.soloLectura).toBe(true);
      expect(res.body.subscriptionStatus).toBe('past_due');
    });

    it('bloquea también otros módulos: no hay que exentar controlador por controlador', async () => {
      await request(app.getHttpServer())
        .post('/api/appointments')
        .set(auth())
        .send({})
        .expect(402);
    });

    it('DEJA marcar notificaciones leídas (exento: es estado de UI)', async () => {
      await request(app.getHttpServer())
        .post('/api/notifications/leer-todas')
        .set(auth())
        .expect(201);
    });

    it('DEJA cambiar la propia contraseña (exento)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/users/me/password')
        .set(auth())
        .send({});
      // 400 = el ValidationPipe rechazó el cuerpo vacío, o sea que el gate
      // ya lo había dejado pasar. Lo que importa es que NO sea 402.
      expect(res.status).not.toBe(402);
      expect(res.status).toBe(400);
    });
  });

  describe('dentro de la gracia todavía no se suspende', () => {
    beforeAll(() => comoTenant('past_due', manana));

    it('sigue pudiendo escribir mientras corre el plazo', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/patients')
        .set(auth())
        .send({});
      expect(res.status).not.toBe(402);
    });
  });

  describe('reanudación tras el pago', () => {
    it('al volver a active, la escritura funciona sin reiniciar nada', async () => {
      // Esto es lo que hace invoice.paid: limpia la gracia. El acceso vuelve
      // en la siguiente petición porque el bloqueo se deriva, no se almacena.
      await comoTenant('past_due', ayer);
      await request(app.getHttpServer())
        .post('/api/patients')
        .set(auth())
        .send({})
        .expect(402);

      await comoTenant('active', null);
      const res = await request(app.getHttpServer()).post('/api/patients').set(auth()).send({});
      expect(res.status).not.toBe(402);
    });
  });

  describe('estados que no deben restringir', () => {
    it.each(['active', 'trialing', 'none'])('%s deja escribir', async (status) => {
      await comoTenant(status, null);
      const res = await request(app.getHttpServer()).post('/api/patients').set(auth()).send({});
      expect(res.status).not.toBe(402);
    });

    it.each(['canceled', 'unpaid'])('%s bloquea aunque no haya gracia', async (status) => {
      await comoTenant(status, null);
      await request(app.getHttpServer()).post('/api/patients').set(auth()).send({}).expect(402);
    });
  });

  it('sin token, el gating no se mete: sigue siendo un 401 de autenticación', async () => {
    await comoTenant('canceled', null);
    await request(app.getHttpServer()).post('/api/patients').send({}).expect(401);
  });

  /**
   * El 402 solo aparece cuando ya se restringió, o sea con la gracia agotada.
   * GET /users/me es lo que permite avisar ANTES — y tiene que funcionar
   * incluso con la cuenta suspendida, porque es justo entonces cuando el banner
   * necesita explicar qué pasa.
   */
  describe('GET /users/me expone el estado de pago', () => {
    const leerPerfil = () =>
      request(app.getHttpServer()).get('/api/users/me').set(auth()).expect(200);

    it('al corriente: no hay nada que avisar', async () => {
      await comoTenant('active', null);
      const { body } = await leerPerfil();
      expect(body.suscripcion).toMatchObject({ aviso: 'ok', graceUntil: null });
    });

    it('dentro de la gracia: advierte y dice hasta cuándo', async () => {
      await comoTenant('past_due', manana);
      const { body } = await leerPerfil();
      expect(body.suscripcion.aviso).toBe('advertencia');
      // La fecha es el contenido del aviso: sin ella el banner no puede
      // cumplir lo que promete la cláusula 5.3 de los términos.
      expect(new Date(body.suscripcion.graceUntil).toISOString()).toBe(
        new Date(manana).toISOString(),
      );
    });

    it('gracia agotada: suspendida, y la lectura sigue respondiendo', async () => {
      await comoTenant('past_due', ayer);
      const { body } = await leerPerfil();
      expect(body.suscripcion).toMatchObject({ aviso: 'suspendida', graceUntil: null });
      // El perfil completo sigue viajando: el gating no bloquea lecturas.
      expect(body.id).toBe(userId);
    });
  });
});
