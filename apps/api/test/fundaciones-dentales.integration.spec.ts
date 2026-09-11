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
    // Norte tiene plan 'clinica' (incluye todos los módulos) y Sur
    // 'individual' (no incluye ninguno): así se prueba el eje de entitlement
    // sin inventar datos, con el mismo mapa plan→módulos que vende la web.
    for (const [id, nombre, plan] of [
      [norte, 'Clínica Fase A Norte', 'clinica'],
      [sur, 'Clínica Fase A Sur', 'individual'],
    ] as const) {
      await admin.db.execute(sql`
        INSERT INTO tenants (id, nombre_clinica, plan, subscription_status)
        VALUES (${id}::uuid, ${nombre}, ${plan}, 'active')
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
      await admin.db.execute(sql`DELETE FROM tenant_module_entitlements WHERE tenant_id=${id}::uuid`);
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

  // ── Capacidad efectiva: contratado / rollout / configuración ────
  describe('capacidad de módulos', () => {
    const modulo = (body: unknown[], flag: string) =>
      body.find((m) => (m as { flag: string }).flag === flag) as Record<string, unknown>;

    it('nada se enciende solo con el despliegue: el plan da el derecho, no el uso', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/modulos')
        .set(auth(tokenTitular))
        .expect(200);
      expect(res.body).toHaveLength(8);
      // Plan 'clinica': todo contratado…
      expect(res.body.every((m: { contratado: boolean }) => m.contratado)).toBe(true);
      // …y nada disponible, porque el titular todavía no activó nada.
      expect(res.body.every((m: { disponible: boolean }) => !m.disponible)).toBe(true);
      expect(modulo(res.body, 'dental_recalls')).toMatchObject({
        contratado: true,
        fuente: 'plan',
        rollout: true,
        configuracion: false,
        disponible: false,
        razon: 'configuracion',
      });
    });

    it('el titular activa el módulo y queda disponible, con bitácora', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/modulos')
        .set(auth(tokenTitular))
        .send({ flag: 'dental_recalls', habilitado: true, notas: 'Piloto septiembre' })
        .expect(200);
      expect(res.body).toMatchObject({ flag: 'dental_recalls', configuracion: true, disponible: true, razon: null });
      expect(res.body.configuradoAt).not.toBeNull();

      const bitacora = (
        await admin.db.execute(sql`
          SELECT accion, detalle FROM audit_log
           WHERE tenant_id=${norte}::uuid AND entidad='Modulo'
        `)
      ).rows as { accion: string; detalle: Record<string, unknown> }[];
      expect(bitacora).toHaveLength(1);
      expect(bitacora[0]).toMatchObject({ accion: 'activar', detalle: { modulo: 'dental_recalls' } });
    });

    it('un plan que no incluye el módulo NO se puede activar por API', async () => {
      // Sur es plan 'individual'. Aunque su titular encienda la configuración,
      // el módulo sigue sin estar disponible: le falta el derecho.
      const titularSur = randomUUID();
      await admin.db.execute(sql`
        INSERT INTO users (id, tenant_id, email, password_hash, nombre, rol, es_medico)
        VALUES (${titularSur}::uuid, ${sur}::uuid, ${`fa-${titularSur}@test.mx`}, 'x', 'Dr. Sur', 'admin', true)
      `);
      const token = app
        .get(JwtService)
        .sign({ sub: titularSur, tid: sur, rol: 'admin' }, { secret: env.jwtSecret });

      const res = await request(app.getHttpServer())
        .put('/api/modulos')
        .set(auth(token))
        .send({ flag: 'dental_recalls', habilitado: true })
        .expect(200);
      expect(res.body).toMatchObject({
        contratado: false,
        fuente: null,
        configuracion: true,
        disponible: false,
        razon: 'entitlement',
      });
    });

    it('la API no puede concederse un derecho: no es un if, es un GRANT', async () => {
      await expect(
        runInTenant(appDb.db, sur, (tx) =>
          tx.execute(sql`
            INSERT INTO tenant_module_entitlements (module_key, source, status)
            VALUES ('dental_recalls', 'manual', 'active')
          `),
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it('la API tampoco puede levantar un rollback de operación', async () => {
      await expect(
        runInTenant(appDb.db, norte, (tx) =>
          tx.execute(sql`UPDATE tenant_feature_flags SET rollout_habilitado=true WHERE flag='dental_recalls'`),
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it('un add-on concedido fuera del plan sí habilita', async () => {
      await admin.db.execute(sql`
        INSERT INTO tenant_module_entitlements (tenant_id, module_key, source, status)
        VALUES (${sur}::uuid, 'dental_recalls', 'addon', 'active')
      `);
      const res = await request(app.getHttpServer()).get('/api/modulos').set(auth(tokenTitular)).expect(200);
      // Norte no ve el derecho de Sur.
      expect(modulo(res.body, 'dental_recalls')).toMatchObject({ fuente: 'plan' });

      const desdeSur = await runInTenant(appDb.db, sur, async (tx) =>
        ((await tx.execute(sql`SELECT count(*)::int n FROM tenant_module_entitlements`)).rows[0] as { n: number }).n,
      );
      expect(desdeSur).toBe(1);
    });

    it('suspender bloquea el uso pero conserva el histórico', async () => {
      await admin.db.execute(sql`
        INSERT INTO tenant_module_entitlements (tenant_id, module_key, source, status)
        VALUES (${norte}::uuid, 'dental_recalls', 'plan', 'suspended')
      `);
      const res = await request(app.getHttpServer()).get('/api/modulos').set(auth(tokenTitular)).expect(200);
      // Aunque el plan 'clinica' lo incluye, la suspensión manda.
      expect(modulo(res.body, 'dental_recalls')).toMatchObject({
        contratado: false,
        disponible: false,
        razon: 'entitlement',
      });
      const filas = (
        await admin.db.execute(sql`
          SELECT count(*)::int n FROM tenant_module_entitlements
           WHERE tenant_id=${norte}::uuid AND module_key='dental_recalls'
        `)
      ).rows[0] as { n: number };
      expect(filas.n).toBe(1);
    });

    it('una prueba vencida devuelve el módulo al plan, no se lo quita', async () => {
      await admin.db.execute(sql`
        UPDATE tenant_module_entitlements SET status='expired', source='trial'
         WHERE tenant_id=${norte}::uuid AND module_key='dental_recalls'
      `);
      const res = await request(app.getHttpServer()).get('/api/modulos').set(auth(tokenTitular)).expect(200);
      expect(modulo(res.body, 'dental_recalls')).toMatchObject({
        contratado: true,
        fuente: 'plan',
        disponible: true,
      });
    });

    it('el rollback de operación apaga el módulo sin tocar lo contratado', async () => {
      await admin.db.execute(sql`
        UPDATE tenant_feature_flags SET rollout_habilitado=false, rollout_nota='incidente'
         WHERE tenant_id=${norte}::uuid AND flag='dental_recalls'
      `);
      const res = await request(app.getHttpServer()).get('/api/modulos').set(auth(tokenTitular)).expect(200);
      expect(modulo(res.body, 'dental_recalls')).toMatchObject({
        contratado: true,
        rollout: false,
        configuracion: true,
        disponible: false,
        razon: 'rollout',
      });
      await admin.db.execute(sql`
        UPDATE tenant_feature_flags SET rollout_habilitado=true
         WHERE tenant_id=${norte}::uuid AND flag='dental_recalls'
      `);
    });

    it('apagar la configuración NO borra la fila ni el histórico', async () => {
      await request(app.getHttpServer())
        .put('/api/modulos')
        .set(auth(tokenTitular))
        .send({ flag: 'dental_recalls', habilitado: false })
        .expect(200);
      const filas = (
        await admin.db.execute(sql`
          SELECT habilitado FROM tenant_feature_flags
           WHERE tenant_id=${norte}::uuid AND flag='dental_recalls'
        `)
      ).rows as { habilitado: boolean }[];
      expect(filas).toHaveLength(1);
      expect(filas[0]?.habilitado).toBe(false);
    });

    it('el asistente puede VER los módulos pero no configurarlos', async () => {
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

    it('la configuración de una clínica es invisible para la otra (RLS)', async () => {
      await runInTenant(appDb.db, norte, async (tx) => {
        await tx.execute(sql`
          INSERT INTO tenant_feature_flags (flag, habilitado) VALUES ('dental_labs', true)
          ON CONFLICT (tenant_id, flag) DO UPDATE SET habilitado=true
        `);
      });
      const desdeSur = await runInTenant(appDb.db, sur, async (tx) =>
        ((await tx.execute(sql`SELECT count(*)::int n FROM tenant_feature_flags WHERE flag='dental_labs'`))
          .rows[0] as { n: number }).n,
      );
      expect(desdeSur).toBe(0);
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

    it('un evento aplazado espera su turno y no gasta reintentos', async () => {
      const id = await emitir(norte, 'treatment_item.completed');
      await appDb.db.execute(sql`SELECT id FROM claim_app_events('recon.prueba', 50)`);
      await appDb.db.execute(
        sql`SELECT defer_app_event(${id}::uuid, 'recon.prueba', 'modulo_entitlement', interval '1 day')`,
      );

      const aplazado = (
        await admin.db.execute(sql`
          SELECT status, attempts, deferrals, last_error_code, next_attempt_at > now() AS espera
            FROM app_event_consumptions WHERE event_id=${id}::uuid AND consumer='recon.prueba'
        `)
      ).rows[0] as { status: string; attempts: number; deferrals: number; last_error_code: string; espera: boolean };
      // attempts vuelve a 0: aplazar no es fallar, y no debe acercar el evento
      // a 'dead' mientras el módulo siga apagado.
      expect(aplazado).toMatchObject({
        status: 'deferred', attempts: 0, deferrals: 1,
        last_error_code: 'modulo_entitlement', espera: true,
      });

      // Mientras no venza, no vuelve a entregarse.
      const pronto = (
        await appDb.db.execute(sql`SELECT id FROM claim_app_events('recon.prueba', 50)`)
      ).rows as { id: string }[];
      expect(pronto.map((r) => r.id)).not.toContain(id);
    });

    it('encender el módulo reconcilia lo que pasó mientras estuvo apagado', async () => {
      const id = await emitir(norte, 'appointment.no_show');
      await appDb.db.execute(sql`SELECT id FROM claim_app_events('recon.encendido', 50)`);
      await appDb.db.execute(
        sql`SELECT defer_app_event(${id}::uuid, 'recon.encendido', 'modulo_configuracion', interval '1 day')`,
      );
      // El worker no espera un día real: se simula que llegó el turno.
      await admin.db.execute(sql`
        UPDATE app_event_consumptions SET next_attempt_at = now() - interval '1 minute'
         WHERE event_id=${id}::uuid AND consumer='recon.encendido'
      `);
      const otra = (
        await appDb.db.execute(sql`SELECT id FROM claim_app_events('recon.encendido', 50)`)
      ).rows as { id: string }[];
      expect(otra.map((r) => r.id)).toContain(id);
    });

    it('fuera de la ventana de reconciliación el evento deja de intentarse', async () => {
      const id = await emitir(norte, 'recall.due');
      await admin.db.execute(sql`
        UPDATE app_events SET occurred_at = now() - interval '100 days' WHERE id=${id}::uuid
      `);
      await appDb.db.execute(sql`SELECT id FROM claim_app_events('recon.viejo', 50)`);
      await appDb.db.execute(
        sql`SELECT defer_app_event(${id}::uuid, 'recon.viejo', 'modulo_entitlement', interval '1 day')`,
      );
      const muerto = (
        await admin.db.execute(sql`
          SELECT status, last_error_code FROM app_event_consumptions
           WHERE event_id=${id}::uuid AND consumer='recon.viejo'
        `)
      ).rows[0] as { status: string; last_error_code: string };
      expect(muerto).toMatchObject({ status: 'dead', last_error_code: 'reconciliation_window_expired' });
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
