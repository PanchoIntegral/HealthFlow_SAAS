import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { loadDotEnv, env } from '../src/config/env';
import { createAdminDb, createAppDb, runInTenant } from '../src/db/drizzle';
import { AppModule } from '../src/app.module';

loadDotEnv();

/**
 * Fase A de los módulos dentales: feature flags por clínica y outbox interna
 * de eventos. Lo que se verifica aquí NO se puede verificar sin PostgreSQL:
 * el aislamiento RLS, los GRANT que hacen append-only a `app_events`, y la
 * exclusión mutua del reclamo de eventos entre dos workers.
 *
 * Requiere `pnpm db:setup && pnpm db:migrate` previos.
 */
describe('Fundaciones de módulos dentales (Fase A)', () => {
  const admin = createAdminDb();
  const appDb = createAppDb();
  let app: INestApplication;

  const norte = randomUUID();
  const sur = randomUUID();
  const titular = randomUUID();
  const asistente = randomUUID();
  let tokenTitular: string;
  let tokenAsistente: string;

  beforeAll(async () => {
    for (const [id, nombre] of [
      [norte, 'Clínica Fase A Norte'],
      [sur, 'Clínica Fase A Sur'],
    ] as const) {
      await admin.db.execute(sql`
        INSERT INTO tenants (id, nombre_clinica, plan, subscription_status)
        VALUES (${id}::uuid, ${nombre}, 'clinica', 'active')
      `);
    }
    await admin.db.execute(sql`
      INSERT INTO users (id, tenant_id, email, password_hash, nombre, rol, es_medico)
      VALUES (${titular}::uuid, ${norte}::uuid, ${`fa-${titular}@test.mx`}, 'x', 'Dra. Titular', 'admin', true),
             (${asistente}::uuid, ${norte}::uuid, ${`fa-${asistente}@test.mx`}, 'x', 'Recepción', 'asistente', false)
    `);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    const jwt = app.get(JwtService);
    tokenTitular = jwt.sign({ sub: titular, tid: norte, rol: 'admin' }, { secret: env.jwtSecret });
    tokenAsistente = jwt.sign(
      { sub: asistente, tid: norte, rol: 'asistente' },
      { secret: env.jwtSecret },
    );
  });

  afterAll(async () => {
    for (const id of [norte, sur]) {
      await admin.db.execute(sql`DELETE FROM app_event_consumptions WHERE tenant_id=${id}::uuid`);
      await admin.db.execute(sql`DELETE FROM app_events WHERE tenant_id=${id}::uuid`);
      await admin.db.execute(sql`DELETE FROM tenant_feature_flags WHERE tenant_id=${id}::uuid`);
      await admin.db.execute(sql`DELETE FROM audit_log WHERE tenant_id=${id}::uuid`);
      await admin.db.execute(sql`DELETE FROM users WHERE tenant_id=${id}::uuid`);
      await admin.db.execute(sql`DELETE FROM tenants WHERE id=${id}::uuid`);
    }
    await app?.close();
    await admin.pool.end();
    await appDb.pool.end();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  // ── Feature flags ──────────────────────────────────────────────
  describe('feature flags', () => {
    it('un módulo sin fila está APAGADO: nada se enciende con el despliegue', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/modulos')
        .set(auth(tokenTitular))
        .expect(200);
      expect(res.body).toHaveLength(8);
      expect(res.body.every((m: { habilitado: boolean }) => m.habilitado === false)).toBe(true);
      expect(res.body.map((m: { flag: string }) => m.flag)).toContain('dental_recalls');
    });

    it('el titular enciende un módulo y queda en bitácora', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/modulos')
        .set(auth(tokenTitular))
        .send({ flag: 'dental_recalls', habilitado: true, notas: 'Piloto septiembre' })
        .expect(200);
      expect(res.body).toMatchObject({ flag: 'dental_recalls', habilitado: true });
      expect(res.body.habilitadoAt).not.toBeNull();

      const bitacora = (
        await admin.db.execute(sql`
          SELECT accion, detalle FROM audit_log
           WHERE tenant_id=${norte}::uuid AND entidad='FeatureFlag'
        `)
      ).rows as { accion: string; detalle: Record<string, unknown> }[];
      expect(bitacora).toHaveLength(1);
      expect(bitacora[0]).toMatchObject({ accion: 'activar', detalle: { flag: 'dental_recalls' } });
    });

    it('apagarlo NO borra la fila ni el histórico (rollback reversible)', async () => {
      await request(app.getHttpServer())
        .put('/api/modulos')
        .set(auth(tokenTitular))
        .send({ flag: 'dental_recalls', habilitado: false })
        .expect(200);
      const filas = (
        await admin.db.execute(sql`
          SELECT habilitado, habilitado_at FROM tenant_feature_flags
           WHERE tenant_id=${norte}::uuid AND flag='dental_recalls'
        `)
      ).rows as { habilitado: boolean; habilitado_at: Date | null }[];
      expect(filas).toHaveLength(1);
      expect(filas[0]?.habilitado).toBe(false);
    });

    it('el asistente puede VER los módulos pero no cambiarlos', async () => {
      await request(app.getHttpServer()).get('/api/modulos').set(auth(tokenAsistente)).expect(200);
      await request(app.getHttpServer())
        .put('/api/modulos')
        .set(auth(tokenAsistente))
        .send({ flag: 'dental_recalls', habilitado: true })
        .expect(403);
    });

    it('rechaza un módulo que no está en el catálogo', async () => {
      await request(app.getHttpServer())
        .put('/api/modulos')
        .set(auth(tokenTitular))
        .send({ flag: 'modulo_inventado', habilitado: true })
        .expect(400);
    });

    it('el flag de una clínica es invisible para la otra (RLS)', async () => {
      await runInTenant(appDb.db, norte, async (tx) => {
        await tx.execute(sql`
          INSERT INTO tenant_feature_flags (flag, habilitado) VALUES ('dental_labs', true)
          ON CONFLICT (tenant_id, flag) DO UPDATE SET habilitado=true
        `);
      });
      const desdeSur = await runInTenant(appDb.db, sur, async (tx) =>
        (await tx.execute(sql`SELECT count(*)::int n FROM tenant_feature_flags`)).rows[0] as {
          n: number;
        },
      );
      expect(desdeSur.n).toBe(0);
    });
  });

  // ── Eventos internos ───────────────────────────────────────────
  describe('outbox interna de eventos', () => {
    const emitir = (tenant: string, tipo = 'appointment.scheduled') =>
      runInTenant(appDb.db, tenant, async (tx) => {
        const row = (
          await tx.execute(sql`
            INSERT INTO app_events (tipo, entidad, entidad_id, payload)
            VALUES (${tipo}, 'appointment', ${randomUUID()}::uuid, '{"status":"agendada"}'::jsonb)
            RETURNING id
          `)
        ).rows[0] as { id: string };
        return row.id;
      });

    it('un evento de una clínica no es visible desde la otra', async () => {
      await emitir(norte);
      const n = await runInTenant(appDb.db, sur, async (tx) =>
        ((await tx.execute(sql`SELECT count(*)::int n FROM app_events`)).rows[0] as { n: number }).n,
      );
      expect(n).toBe(0);
    });

    it('es append-only: la aplicación no puede reescribir la historia', async () => {
      const id = await emitir(norte);
      await expect(
        runInTenant(appDb.db, norte, (tx) =>
          tx.execute(sql`UPDATE app_events SET tipo='recall.due' WHERE id=${id}::uuid`),
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        runInTenant(appDb.db, norte, (tx) =>
          tx.execute(sql`DELETE FROM app_events WHERE id=${id}::uuid`),
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it('rechaza un payload desmedido (mismo límite que el dominio)', async () => {
      const enorme = JSON.stringify({ x: 'y'.repeat(5000) });
      await expect(
        runInTenant(appDb.db, norte, (tx) =>
          tx.execute(sql`
            INSERT INTO app_events (tipo, entidad, payload)
            VALUES ('recall.due', 'recall', ${enorme}::jsonb)
          `),
        ),
      ).rejects.toThrow();
    });

    it('dos workers no procesan el mismo evento: el reclamo es excluyente', async () => {
      const id = await emitir(norte, 'recall.due');
      const primero = (
        await appDb.db.execute(sql`SELECT id FROM claim_app_events('recalls.cerrar', 50)`)
      ).rows as { id: string }[];
      const segundo = (
        await appDb.db.execute(sql`SELECT id FROM claim_app_events('recalls.cerrar', 50)`)
      ).rows as { id: string }[];
      expect(primero.map((r) => r.id)).toContain(id);
      expect(segundo.map((r) => r.id)).not.toContain(id);
    });

    it('cada consumidor avanza por su cuenta sobre el mismo evento', async () => {
      const id = await emitir(norte, 'treatment_item.completed');
      const inventario = (
        await appDb.db.execute(sql`SELECT id FROM claim_app_events('inventario.sugerir', 50)`)
      ).rows as { id: string }[];
      const reportes = (
        await appDb.db.execute(sql`SELECT id FROM claim_app_events('reportes.produccion', 50)`)
      ).rows as { id: string }[];
      expect(inventario.map((r) => r.id)).toContain(id);
      expect(reportes.map((r) => r.id)).toContain(id);
    });

    it('un evento cerrado con éxito no vuelve a entregarse nunca', async () => {
      const id = await emitir(norte, 'appointment.cancelled');
      await appDb.db.execute(sql`SELECT id FROM claim_app_events('recalls.reabrir', 50)`);
      await appDb.db.execute(sql`SELECT complete_app_event(${id}::uuid, 'recalls.reabrir', true, NULL)`);
      // Aun forzando el vencimiento del reclamo, un 'done' no se reabre.
      await admin.db.execute(sql`
        UPDATE app_event_consumptions SET updated_at = now() - interval '1 hour'
         WHERE event_id=${id}::uuid AND consumer='recalls.reabrir'
      `);
      const otra = (
        await appDb.db.execute(sql`SELECT id FROM claim_app_events('recalls.reabrir', 50)`)
      ).rows as { id: string }[];
      expect(otra.map((r) => r.id)).not.toContain(id);
    });

    it('un fallo reintenta con backoff y muere a los 8 intentos', async () => {
      const id = await emitir(norte, 'lab_case.status_changed');
      await appDb.db.execute(sql`SELECT id FROM claim_app_events('labs.alertas', 50)`);
      await appDb.db.execute(
        sql`SELECT complete_app_event(${id}::uuid, 'labs.alertas', false, 'boom')`,
      );
      const fallido = (
        await admin.db.execute(sql`
          SELECT status, attempts, last_error_code, next_attempt_at > now() AS espera
            FROM app_event_consumptions WHERE event_id=${id}::uuid AND consumer='labs.alertas'
        `)
      ).rows[0] as { status: string; attempts: number; last_error_code: string; espera: boolean };
      expect(fallido).toMatchObject({ status: 'failed', attempts: 1, last_error_code: 'boom', espera: true });

      await admin.db.execute(sql`
        UPDATE app_event_consumptions SET attempts=8, next_attempt_at=now()
         WHERE event_id=${id}::uuid AND consumer='labs.alertas'
      `);
      await appDb.db.execute(
        sql`SELECT complete_app_event(${id}::uuid, 'labs.alertas', false, 'boom')`,
      );
      const muerto = (
        await admin.db.execute(sql`
          SELECT status FROM app_event_consumptions
           WHERE event_id=${id}::uuid AND consumer='labs.alertas'
        `)
      ).rows[0] as { status: string };
      expect(muerto.status).toBe('dead');
    });

    it('una consumición no puede atribuirse a un tenant que no es el del evento', async () => {
      const id = await emitir(norte, 'recall.scheduled');
      await expect(
        runInTenant(appDb.db, sur, (tx) =>
          tx.execute(sql`
            INSERT INTO app_event_consumptions (event_id, consumer) VALUES (${id}::uuid, 'intruso')
          `),
        ),
      ).rejects.toThrow(/does not belong|violates/i);
    });
  });
});
