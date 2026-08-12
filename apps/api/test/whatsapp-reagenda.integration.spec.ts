import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { loadDotEnv } from '../src/config/env';
import { createAdminDb } from '../src/db/drizzle';
import { AppModule } from '../src/app.module';
import { ThrottlerStorage } from '@nestjs/throttler';

loadDotEnv();

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const nuevoToken = () => randomBytes(32).toString('base64url');

/**
 * Página pública de reagendado.
 *
 * Es la segunda ruta sin JWT del sistema, y aquí el enlace ES la credencial:
 * quien lo tenga puede mover una cita. Lo que se comprueba: que un token no
 * sirva dos veces, que no cruce clínicas, y que la página no filtre nada
 * clínico a un navegador sin sesión.
 */
describe('Reagendado público', () => {
  const admin = createAdminDb();
  let app: INestApplication;

  interface Clinica {
    tenantId: string;
    doctorId: string;
    pacienteId: string;
    citaId: string;
    nombre: string;
  }
  const a = nuevaClinica('Clínica Reagenda A');
  const b = nuevaClinica('Clínica Reagenda B');

  /** La cita está pasado mañana a mediodía, con margen para mover. */
  const INICIO_CITA = new Date(Date.now() + 2 * DIA);
  const MOTIVO = 'Control de diabetes — dato clínico que no debe salir';

  function nuevaClinica(nombre: string): Clinica {
    return {
      tenantId: randomUUID(),
      doctorId: randomUUID(),
      pacienteId: randomUUID(),
      citaId: randomUUID(),
      nombre,
    };
  }

  async function sembrar(c: Clinica) {
    await admin.db.execute(sql`
      INSERT INTO tenants (id, nombre_clinica, plan, subscription_status)
      VALUES (${c.tenantId}::uuid, ${c.nombre}, 'consultorio', 'active')
    `);
    await admin.db.execute(sql`
      INSERT INTO users (id, tenant_id, email, password_hash, nombre, rol, es_medico)
      VALUES (${c.doctorId}::uuid, ${c.tenantId}::uuid, ${`rg-${c.doctorId}@test.mx`},
              'x', ${`Dra. de ${c.nombre}`}, 'admin', true)
    `);
    await admin.db.execute(sql`
      INSERT INTO patients (id, tenant_id, nombre, fecha_nacimiento, curp, telefono_e164, whatsapp_opt_in)
      VALUES (${c.pacienteId}::uuid, ${c.tenantId}::uuid, 'María de los Ángeles Fernández',
              '1980-03-03', 'FEAM800303MDFRNR01', '+525551110000', true)
    `);
    await admin.db.execute(sql`
      INSERT INTO appointments (id, tenant_id, patient_id, doctor_id, motivo,
                                inicio_programado, fin_programado, estatus)
      VALUES (${c.citaId}::uuid, ${c.tenantId}::uuid, ${c.pacienteId}::uuid, ${c.doctorId}::uuid,
              ${MOTIVO},
              ${INICIO_CITA.toISOString()}::timestamptz,
              ${new Date(INICIO_CITA.getTime() + HORA).toISOString()}::timestamptz, 'agendada')
    `);
    await admin.db.execute(sql`
      INSERT INTO tenant_whatsapp_config (tenant_id, activo, nombre_remitente, zona_horaria)
      VALUES (${c.tenantId}::uuid, true, ${c.nombre}, 'America/Mexico_City')
    `);
  }

  /** Inserta un token para esa cita y devuelve el valor en claro. */
  async function emitir(
    c: Clinica,
    opciones: { expiraEn?: Date; consumido?: boolean } = {},
  ): Promise<string> {
    const token = nuevoToken();
    const expira = opciones.expiraEn ?? new Date(Date.now() + 72 * HORA);
    await admin.db.execute(sql`
      INSERT INTO whatsapp_reagenda_tokens (tenant_id, appointment_id, token_hash, expires_at, consumed_at)
      VALUES (${c.tenantId}::uuid, ${c.citaId}::uuid, ${hash(token)},
              ${expira.toISOString()}::timestamptz,
              ${opciones.consumido ? new Date().toISOString() : null}::timestamptz)
    `);
    return token;
  }

  beforeAll(async () => {
    await sembrar(a);
    await sembrar(b);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    for (const c of [a, b]) {
      await admin.db.execute(
        sql`DELETE FROM whatsapp_reagenda_tokens WHERE tenant_id = ${c.tenantId}::uuid`,
      );
      await admin.db.execute(sql`DELETE FROM whatsapp_outbox WHERE tenant_id = ${c.tenantId}::uuid`);
      await admin.db.execute(
        sql`DELETE FROM tenant_whatsapp_config WHERE tenant_id = ${c.tenantId}::uuid`,
      );
      await admin.db.execute(sql`DELETE FROM appointments WHERE tenant_id = ${c.tenantId}::uuid`);
      await admin.db.execute(sql`DELETE FROM patients WHERE tenant_id = ${c.tenantId}::uuid`);
      await admin.db.execute(sql`DELETE FROM audit_log WHERE tenant_id = ${c.tenantId}::uuid`);
      await admin.db.execute(sql`DELETE FROM users WHERE tenant_id = ${c.tenantId}::uuid`);
      await admin.db.execute(sql`DELETE FROM tenants WHERE id = ${c.tenantId}::uuid`);
    }
    await app?.close();
    await admin.pool.end();
  });

  const http = () => request(app.getHttpServer());

  /**
   * El controller limita a 10 peticiones por minuto y por IP: es una ruta
   * anónima que escribe en la agenda, así que el límite es estrecho a
   * propósito. La suite entera sale de la misma IP y haría saltar el límite a
   * media corrida, así que se vacía el contador entre casos — el guard sigue
   * montado, y que de verdad corte se comprueba en «límite de peticiones».
   */
  const olvidarPeticiones = () => {
    const almacen = app.get<ThrottlerStorage>(ThrottlerStorage) as unknown as {
      storage?: Map<string, unknown>;
    };
    almacen.storage?.clear();
  };

  afterEach(() => olvidarPeticiones());

  async function cita(c: Clinica) {
    const r = await admin.db.execute(sql`
      SELECT estatus, inicio_programado, confirmada_at FROM appointments WHERE id = ${c.citaId}::uuid
    `);
    return r.rows[0] as { estatus: string; inicio_programado: Date; confirmada_at: Date | null };
  }

  describe('abrir el enlace', () => {
    it('muestra clínica, médico y hora', async () => {
      const token = await emitir(a);
      const res = await http().get(`/api/publico/reagendar/${token}`).expect(200);
      expect(res.body).toMatchObject({
        nombreClinica: a.nombre,
        duracionMinutos: 60,
      });
      expect(res.body.doctorNombre).toContain('Dra.');
    });

    // El enlace vive para siempre en el historial de un WhatsApp, y ese
    // teléfono puede acabar prestado o compartido.
    it('NO filtra nada clínico ni identificadores del paciente', async () => {
      const token = await emitir(a);
      const res = await http().get(`/api/publico/reagendar/${token}`).expect(200);
      const cuerpo = JSON.stringify(res.body);

      expect(cuerpo).not.toContain('diabetes');
      expect(cuerpo).not.toContain(MOTIVO);
      expect(cuerpo).not.toContain('FEAM800303');
      expect(cuerpo).not.toContain('María');
      expect(cuerpo).not.toContain('+525551110000');
      expect(res.body).not.toHaveProperty('motivo');
      expect(res.body).not.toHaveProperty('patientId');
    });
  });

  describe('tokens que no sirven', () => {
    // Todos devuelven lo mismo: distinguir "no existe" de "ya se usó" solo le
    // sirve a quien está probando tokens a ver cuál pega.
    it.each([
      ['inventado', async () => nuevoToken()],
      ['ya consumido', async () => emitir(a, { consumido: true })],
      ['expirado', async () => emitir(a, { expiraEn: new Date(Date.now() - HORA) })],
    ])('rechaza con 404 un token %s', async (_caso, hacer) => {
      const token = await hacer();
      const res = await http().get(`/api/publico/reagendar/${token}`).expect(404);
      expect(res.body.error).toBe('TokenReagendaInvalido');
    });

    it('no distingue entre inválido y expirado en el mensaje', async () => {
      const inventado = await http().get(`/api/publico/reagendar/${nuevoToken()}`).expect(404);
      const expirado = await http()
        .get(`/api/publico/reagendar/${await emitir(a, { expiraEn: new Date(Date.now() - HORA) })}`)
        .expect(404);
      expect(inventado.body.message).toBe(expirado.body.message);
    });
  });

  describe('el token solo se guarda hasheado', () => {
    it('el valor en claro no está en la base', async () => {
      const token = await emitir(a);
      const r = await admin.db.execute(
        sql`SELECT count(*)::int AS n FROM whatsapp_reagenda_tokens WHERE token_hash = ${token}`,
      );
      expect((r.rows[0] as { n: number }).n).toBe(0);
    });
  });

  describe('huecos disponibles', () => {
    it('ofrece horarios futuros de la misma duración', async () => {
      const token = await emitir(a);
      const res = await http().get(`/api/publico/reagendar/${token}/huecos`).expect(200);

      expect(res.body.length).toBeGreaterThan(0);
      for (const hueco of res.body) {
        const inicio = new Date(hueco.inicio);
        const fin = new Date(hueco.fin);
        expect(inicio.getTime()).toBeGreaterThan(Date.now());
        expect(fin.getTime() - inicio.getTime()).toBe(HORA);
      }
    });

    it('no ofrece el horario que ya ocupa la propia cita', async () => {
      const token = await emitir(a);
      const res = await http().get(`/api/publico/reagendar/${token}/huecos`).expect(200);
      const inicios = res.body.map((h: { inicio: string }) => h.inicio);
      expect(inicios).not.toContain(INICIO_CITA.toISOString());
    });
  });

  describe('reagendar de verdad', () => {
    let nuevoInicio: string;

    beforeAll(async () => {
      olvidarPeticiones();
      const token = await emitir(a);
      const huecos = await http().get(`/api/publico/reagendar/${token}/huecos`).expect(200);
      nuevoInicio = huecos.body[0].inicio;
      await http()
        .post(`/api/publico/reagendar/${token}`)
        .send({ inicio: nuevoInicio })
        .expect(201);
    });

    it('mueve la cita al horario elegido', async () => {
      expect(new Date((await cita(a)).inicio_programado).toISOString()).toBe(nuevoInicio);
    });

    // Elegir hora ES confirmar que va a venir.
    it('marca la cita como confirmada', async () => {
      expect((await cita(a)).confirmada_at).not.toBeNull();
    });

    it('deja bitácora con el antes y el después, atribuida al sistema', async () => {
      const r = await admin.db.execute(sql`
        SELECT user_id, detalle FROM audit_log
         WHERE tenant_id = ${a.tenantId}::uuid AND accion = 'reagendar'
      `);
      const fila = r.rows[0] as { user_id: string | null; detalle: Record<string, string> };
      expect(fila.user_id).toBeNull();
      expect(fila.detalle.origen).toBe('whatsapp');
      expect(fila.detalle.a).toBe(nuevoInicio);
    });

    it('no toca la cita de la otra clínica', async () => {
      expect(new Date((await cita(b)).inicio_programado).toISOString()).toBe(
        INICIO_CITA.toISOString(),
      );
    });
  });

  describe('un solo uso', () => {
    it('el segundo intento con el mismo token falla', async () => {
      const token = await emitir(b);
      const huecos = await http().get(`/api/publico/reagendar/${token}/huecos`).expect(200);
      const inicio = huecos.body[0].inicio;

      await http().post(`/api/publico/reagendar/${token}`).send({ inicio }).expect(201);
      await http().post(`/api/publico/reagendar/${token}`).send({ inicio }).expect(404);
    });
  });

  describe('el horario recibido se revalida', () => {
    // La lista de huecos pudo quedar obsoleta mientras el paciente decidía, y
    // nada impide mandar aquí un instante que nunca se ofreció.
    it('rechaza un horario en el pasado', async () => {
      const token = await emitir(a);
      await http()
        .post(`/api/publico/reagendar/${token}`)
        .send({ inicio: new Date(Date.now() - DIA).toISOString() })
        .expect(409);
    });

    it('rechaza una fecha con formato inválido', async () => {
      const token = await emitir(a);
      await http().post(`/api/publico/reagendar/${token}`).send({ inicio: 'mañana' }).expect(400);
    });
  });

  describe('una cita cancelada ya no se reagenda', () => {
    it('devuelve 409 aunque el token sea válido', async () => {
      const token = await emitir(b);
      await admin.db.execute(
        sql`UPDATE appointments SET estatus = 'cancelada' WHERE id = ${b.citaId}::uuid`,
      );
      const res = await http().get(`/api/publico/reagendar/${token}`).expect(409);
      expect(res.body.error).toBe('CitaNoReagendable');

      await admin.db.execute(
        sql`UPDATE appointments SET estatus = 'agendada' WHERE id = ${b.citaId}::uuid`,
      );
    });
  });

  describe('límite de peticiones', () => {
    // Es una ruta anónima que escribe en la agenda: sin tope, probar tokens al
    // azar saldría gratis.
    it('corta con 429 al pasarse del límite por IP', async () => {
      olvidarPeticiones();
      const token = await emitir(a);

      let visto429 = false;
      for (let i = 0; i < 15 && !visto429; i++) {
        const res = await http().get(`/api/publico/reagendar/${token}`);
        if (res.status === 429) visto429 = true;
      }
      expect(visto429).toBe(true);
    });
  });
});
