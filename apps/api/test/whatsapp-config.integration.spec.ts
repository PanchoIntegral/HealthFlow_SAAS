import { randomBytes, randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { loadDotEnv, env } from '../src/config/env';
import { createAdminDb, runInTenant, createAppDb } from '../src/db/drizzle';
import { descifrarSecreto, cargarKeyring } from '../src/common/crypto/secreto-cifrado';
import { AppModule } from '../src/app.module';

loadDotEnv();

// Llavero de la corrida. Se fija ANTES de que nadie lea `env`, que resuelve
// sus getters de forma perezosa.
const LLAVE = randomBytes(32).toString('base64');
process.env.WHATSAPP_TOKEN_KEYS = JSON.stringify({ k1: LLAVE });
process.env.WHATSAPP_TOKEN_KEY_ACTIVE = 'k1';

/**
 * Configuración de recordatorios por WhatsApp: aislamiento entre clínicas y
 * tratamiento del access token.
 *
 * Lo que se verifica aquí es lo que más caro sale si falla: que la clínica A no
 * pueda leer la configuración de la B, y que el token guardado por A no se
 * pueda descifrar como si fuera de la B ni salga nunca por la API.
 */
describe('Configuración de WhatsApp (aislamiento y secretos)', () => {
  const admin = createAdminDb();
  const app_ = createAppDb();
  let app: INestApplication;

  const clinicas = {
    a: { tenantId: randomUUID(), userId: randomUUID(), token: '' },
    b: { tenantId: randomUUID(), userId: randomUUID(), token: '' },
  };

  const TOKEN_META_A = 'EAAG-token-secretisimo-de-la-clinica-A';

  beforeAll(async () => {
    for (const [nombre, c] of Object.entries(clinicas)) {
      await admin.db.execute(sql`
        INSERT INTO tenants (id, nombre_clinica, plan, subscription_status)
        VALUES (${c.tenantId}::uuid, ${`Clínica WA ${nombre}`}, 'consultorio', 'active')
      `);
      await admin.db.execute(sql`
        INSERT INTO users (id, tenant_id, email, password_hash, nombre, rol, es_medico)
        VALUES (${c.userId}::uuid, ${c.tenantId}::uuid, ${`wa-${c.userId}@test.mx`},
                'x', ${`Dra. WA ${nombre}`}, 'admin', true)
      `);
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    const jwt = app.get(JwtService);
    for (const c of Object.values(clinicas)) {
      c.token = jwt.sign(
        { sub: c.userId, tid: c.tenantId, rol: 'admin' },
        { secret: env.jwtSecret },
      );
    }
  });

  afterAll(async () => {
    for (const c of Object.values(clinicas)) {
      await admin.db.execute(
        sql`DELETE FROM tenant_whatsapp_config WHERE tenant_id = ${c.tenantId}::uuid`,
      );
      // Antes que users: guardar la configuración deja bitácora, y audit_log
      // referencia al usuario que la escribió.
      await admin.db.execute(sql`DELETE FROM audit_log WHERE tenant_id = ${c.tenantId}::uuid`);
      await admin.db.execute(sql`DELETE FROM users WHERE tenant_id = ${c.tenantId}::uuid`);
      await admin.db.execute(sql`DELETE FROM tenants WHERE id = ${c.tenantId}::uuid`);
    }
    await app?.close();
    await admin.pool.end();
    await app_.pool.end();
  });

  const auth = (quien: 'a' | 'b') => ({ Authorization: `Bearer ${clinicas[quien].token}` });

  describe('valores por defecto', () => {
    it('devuelve una configuración apagada aunque no exista fila', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/whatsapp/config')
        .set(auth('a'))
        .expect(200);

      expect(res.body).toMatchObject({
        modo: 'compartido',
        activo: false,
        tieneToken: false,
        horasAnticipacion: 24,
      });
    });
  });

  describe('reglas de negocio en el borde HTTP', () => {
    it('no deja activar sin el nombre de la clínica', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/whatsapp/config')
        .set(auth('a'))
        .send({ activo: true })
        .expect(400);
      expect(res.body.error).toBe('ConfigWhatsappIncompleta');
    });

    it('no deja pasar a número propio sin credenciales', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/whatsapp/config')
        .set(auth('a'))
        .send({ modo: 'propio' })
        .expect(400);
      expect(res.body.error).toBe('CredencialesWhatsappFaltantes');
    });

    it('rechaza una zona horaria inexistente', async () => {
      await request(app.getHttpServer())
        .put('/api/whatsapp/config')
        .set(auth('a'))
        .send({ zonaHoraria: 'America/Atlantis' })
        .expect(400);
    });

    it('rechaza una anticipación fuera de rango antes de llegar al dominio', async () => {
      await request(app.getHttpServer())
        .put('/api/whatsapp/config')
        .set(auth('a'))
        .send({ horasAnticipacion: 999 })
        .expect(400);
    });
  });

  describe('el access token', () => {
    beforeAll(async () => {
      await request(app.getHttpServer())
        .put('/api/whatsapp/config')
        .set(auth('a'))
        .send({
          modo: 'propio',
          phoneNumberId: '1234567890',
          accessToken: TOKEN_META_A,
          nombreRemitente: 'Clínica del Valle',
          activo: true,
        })
        .expect(200);
    });

    it('nunca sale por la API', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/whatsapp/config')
        .set(auth('a'))
        .expect(200);

      expect(res.body.tieneToken).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain(TOKEN_META_A);
      expect(res.body).not.toHaveProperty('accessToken');
      expect(res.body).not.toHaveProperty('accessTokenCifrado');
    });

    it('se guarda cifrado, no en claro', async () => {
      const guardado = await leerCifrado(clinicas.a.tenantId);
      expect(guardado).not.toBeNull();
      expect(guardado).not.toContain(TOKEN_META_A);
      expect(guardado!.startsWith('v1.k1.')).toBe(true);
    });

    it('se descifra con el tenant dueño', async () => {
      const guardado = await leerCifrado(clinicas.a.tenantId);
      const keyring = cargarKeyring(JSON.stringify({ k1: LLAVE }), 'k1');
      expect(descifrarSecreto(guardado!, clinicas.a.tenantId, keyring)).toBe(TOKEN_META_A);
    });

    // La razón de ser del AAD: una fila robada o copiada a otra clínica no
    // entrega el token, aunque quien la copie tenga la llave.
    it('NO se descifra con el tenant de otra clínica', async () => {
      const guardado = await leerCifrado(clinicas.a.tenantId);
      const keyring = cargarKeyring(JSON.stringify({ k1: LLAVE }), 'k1');
      expect(() => descifrarSecreto(guardado!, clinicas.b.tenantId, keyring)).toThrow();
    });

    it('no se borra al guardar otros campos', async () => {
      await request(app.getHttpServer())
        .put('/api/whatsapp/config')
        .set(auth('a'))
        .send({ horasAnticipacion: 48 })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/whatsapp/config')
        .set(auth('a'))
        .expect(200);
      expect(res.body.tieneToken).toBe(true);
      expect(res.body.horasAnticipacion).toBe(48);
    });
  });

  describe('aislamiento entre clínicas', () => {
    it('la clínica B no ve la configuración de la A', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/whatsapp/config')
        .set(auth('b'))
        .expect(200);

      expect(res.body.activo).toBe(false);
      expect(res.body.tieneToken).toBe(false);
      expect(res.body.nombreRemitente).toBeNull();
    });

    it('guardar en B no toca la fila de A', async () => {
      await request(app.getHttpServer())
        .put('/api/whatsapp/config')
        .set(auth('b'))
        .send({ nombreRemitente: 'Clínica B', horasAnticipacion: 2 })
        .expect(200);

      const a = await request(app.getHttpServer())
        .get('/api/whatsapp/config')
        .set(auth('a'))
        .expect(200);
      expect(a.body.nombreRemitente).toBe('Clínica del Valle');
      expect(a.body.horasAnticipacion).toBe(48);
    });

    // La barrera de verdad: con el tenant B fijado, Postgres no entrega la
    // fila de A ni aunque la query no filtre por tenant.
    it('con el tenant B fijado, la fila de A no existe para la base', async () => {
      const visibles = await runInTenant(app_.db, clinicas.b.tenantId, async (tx) => {
        const r = await tx.execute(
          sql`SELECT tenant_id FROM tenant_whatsapp_config
               WHERE tenant_id = ${clinicas.a.tenantId}::uuid`,
        );
        return r.rows.length;
      });
      expect(visibles).toBe(0);
    });

    it('sin tenant fijado no se ve ninguna configuración', async () => {
      const r = await app_.db.execute(sql`SELECT count(*)::int AS n FROM tenant_whatsapp_config`);
      expect((r.rows[0] as { n: number }).n).toBe(0);
    });
  });

  async function leerCifrado(tenantId: string): Promise<string | null> {
    const r = await admin.db.execute(
      sql`SELECT access_token_cifrado FROM tenant_whatsapp_config
           WHERE tenant_id = ${tenantId}::uuid`,
    );
    return (r.rows[0] as { access_token_cifrado: string | null } | undefined)
      ?.access_token_cifrado ?? null;
  }
});
