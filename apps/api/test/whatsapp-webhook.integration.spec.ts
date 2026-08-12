import { createHmac, randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { loadDotEnv } from '../src/config/env';
import { createAdminDb } from '../src/db/drizzle';
import { AppModule } from '../src/app.module';

loadDotEnv();

// Secretos de la corrida, fijados antes de que nadie lea `env` (getters lazy).
const APP_SECRET = `secreto-de-prueba-${randomUUID()}`;
const VERIFY_TOKEN = `verify-${randomUUID()}`;
process.env.WHATSAPP_APP_SECRET = APP_SECRET;
process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;

const HORA = 60 * 60 * 1000;

/**
 * Webhook de Meta: la única ruta pública de escritura de la API.
 *
 * Sin JWT delante, la firma HMAC es la ÚNICA defensa: si se pudiera falsificar,
 * cualquiera con la URL cancelaría citas de clínicas que no conoce. Aquí se
 * comprueba que sin firma válida no se toca la base, y que la resolución de a
 * qué clínica pertenece una respuesta va siempre por el id del mensaje y nunca
 * por el teléfono de quien escribe.
 */
describe('Webhook de WhatsApp', () => {
  const admin = createAdminDb();
  let app: INestApplication;

  interface Clinica {
    tenantId: string;
    doctorId: string;
    pacienteId: string;
    citaId: string;
    outboxId: string;
    metaMessageId: string;
    nombre: string;
  }

  /** Mismo celular en dos clínicas: el caso que hace peligroso rutear por teléfono. */
  const TELEFONO = '+525557654321';
  const a = nuevaClinica('Clínica Webhook A');
  const b = nuevaClinica('Clínica Webhook B');

  function nuevaClinica(nombre: string): Clinica {
    return {
      tenantId: randomUUID(),
      doctorId: randomUUID(),
      pacienteId: randomUUID(),
      citaId: randomUUID(),
      outboxId: randomUUID(),
      metaMessageId: `wamid.${randomUUID()}`,
      nombre,
    };
  }

  async function sembrar(c: Clinica) {
    const enUnDia = new Date(Date.now() + 24 * HORA);
    await admin.db.execute(sql`
      INSERT INTO tenants (id, nombre_clinica, plan, subscription_status)
      VALUES (${c.tenantId}::uuid, ${c.nombre}, 'consultorio', 'active')
    `);
    await admin.db.execute(sql`
      INSERT INTO users (id, tenant_id, email, password_hash, nombre, rol, es_medico)
      VALUES (${c.doctorId}::uuid, ${c.tenantId}::uuid, ${`wh-${c.doctorId}@test.mx`},
              'x', ${`Dr. de ${c.nombre}`}, 'admin', true)
    `);
    await admin.db.execute(sql`
      INSERT INTO patients (id, tenant_id, nombre, fecha_nacimiento, telefono_e164, whatsapp_opt_in)
      VALUES (${c.pacienteId}::uuid, ${c.tenantId}::uuid, ${`Paciente ${c.nombre}`},
              '1990-01-01', ${TELEFONO}, true)
    `);
    await admin.db.execute(sql`
      INSERT INTO appointments (id, tenant_id, patient_id, doctor_id,
                                inicio_programado, fin_programado, estatus)
      VALUES (${c.citaId}::uuid, ${c.tenantId}::uuid, ${c.pacienteId}::uuid, ${c.doctorId}::uuid,
              ${enUnDia.toISOString()}::timestamptz,
              ${new Date(enUnDia.getTime() + HORA).toISOString()}::timestamptz, 'agendada')
    `);
    await admin.db.execute(sql`
      INSERT INTO tenant_whatsapp_config (tenant_id, activo, nombre_remitente)
      VALUES (${c.tenantId}::uuid, true, ${c.nombre})
    `);
    await admin.db.execute(sql`
      INSERT INTO whatsapp_outbox (id, tenant_id, patient_id, appointment_id, plantilla,
                                   estado, meta_message_id, programado_para, enviado_at)
      VALUES (${c.outboxId}::uuid, ${c.tenantId}::uuid, ${c.pacienteId}::uuid, ${c.citaId}::uuid,
              'recordatorio_cita', 'enviado', ${c.metaMessageId}, now(), now())
    `);
  }

  beforeAll(async () => {
    await sembrar(a);
    await sembrar(b);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true }); // como en main.ts
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await admin.db.execute(sql`DELETE FROM whatsapp_events`);
    for (const c of [a, b]) {
      await admin.db.execute(sql`DELETE FROM whatsapp_outbox WHERE tenant_id = ${c.tenantId}::uuid`);
      await admin.db.execute(
        sql`DELETE FROM tenant_whatsapp_config WHERE tenant_id = ${c.tenantId}::uuid`,
      );
      await admin.db.execute(sql`DELETE FROM notifications WHERE tenant_id = ${c.tenantId}::uuid`);
      await admin.db.execute(sql`DELETE FROM appointments WHERE tenant_id = ${c.tenantId}::uuid`);
      await admin.db.execute(sql`DELETE FROM patients WHERE tenant_id = ${c.tenantId}::uuid`);
      await admin.db.execute(sql`DELETE FROM audit_log WHERE tenant_id = ${c.tenantId}::uuid`);
      await admin.db.execute(sql`DELETE FROM users WHERE tenant_id = ${c.tenantId}::uuid`);
      await admin.db.execute(sql`DELETE FROM tenants WHERE id = ${c.tenantId}::uuid`);
    }
    await app?.close();
    await admin.pool.end();
  });

  const firmar = (cuerpo: string) =>
    'sha256=' + createHmac('sha256', APP_SECRET).update(cuerpo).digest('hex');

  /** POST firmado correctamente. */
  const postFirmado = (payload: unknown) => {
    const cuerpo = JSON.stringify(payload);
    return request(app.getHttpServer())
      .post('/api/whatsapp/webhook')
      .set('X-Hub-Signature-256', firmar(cuerpo))
      .set('Content-Type', 'application/json')
      .send(cuerpo);
  };

  const sobreBoton = (metaMessageId: string, payload: string) => ({
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  from: TELEFONO.replace('+', ''),
                  id: `wamid.resp.${randomUUID()}`,
                  type: 'button',
                  context: { id: metaMessageId },
                  button: { payload, text: payload },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  /** Espera a que termine el procesamiento asíncrono posterior al 200. */
  const esperarProceso = () => new Promise((r) => setTimeout(r, 250));

  async function cita(c: Clinica) {
    const r = await admin.db.execute(
      sql`SELECT estatus, confirmada_at FROM appointments WHERE id = ${c.citaId}::uuid`,
    );
    return r.rows[0] as { estatus: string; confirmada_at: Date | null };
  }

  describe('handshake de verificación', () => {
    it('devuelve el challenge con el token correcto', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/whatsapp/webhook')
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '4242' })
        .expect(200);
      expect(res.text).toBe('4242');
    });

    it.each([
      ['token equivocado', { 'hub.verify_token': 'otro', 'hub.challenge': 'x' }],
      ['sin token', { 'hub.challenge': 'x' }],
      ['modo equivocado', { 'hub.mode': 'unsubscribe', 'hub.verify_token': VERIFY_TOKEN }],
    ])('rechaza con 403: %s', async (_caso, query) => {
      await request(app.getHttpServer())
        .get('/api/whatsapp/webhook')
        .query({ 'hub.mode': 'subscribe', ...query })
        .expect(403);
    });
  });

  describe('verificación de la firma', () => {
    // Sin JWT delante, esto es lo único que separa un evento legítimo de
    // cualquiera que conozca la URL.
    it.each([
      ['sin cabecera de firma', undefined],
      ['firma vacía', ''],
      ['firma con otra longitud', 'sha256=abc'],
      ['firma bien formada pero falsa', 'sha256=' + 'a'.repeat(64)],
    ])('rechaza con 403: %s', async (_caso, firma) => {
      const req = request(app.getHttpServer())
        .post('/api/whatsapp/webhook')
        .set('Content-Type', 'application/json');
      if (firma !== undefined) req.set('X-Hub-Signature-256', firma);
      await req.send(JSON.stringify(sobreBoton(a.metaMessageId, 'cancelar'))).expect(403);
    });

    it('rechaza una firma calculada sobre OTRO cuerpo', async () => {
      const cuerpo = JSON.stringify(sobreBoton(a.metaMessageId, 'cancelar'));
      await request(app.getHttpServer())
        .post('/api/whatsapp/webhook')
        .set('X-Hub-Signature-256', firmar('{"otra":"cosa"}'))
        .set('Content-Type', 'application/json')
        .send(cuerpo)
        .expect(403);
    });

    // La firma se comprueba ANTES de tocar la base: un flood de basura no debe
    // costar ni una escritura.
    it('un rechazo no deja rastro en whatsapp_events', async () => {
      const antes = await contarEventos();
      await request(app.getHttpServer())
        .post('/api/whatsapp/webhook')
        .set('X-Hub-Signature-256', 'sha256=' + 'b'.repeat(64))
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(sobreBoton(a.metaMessageId, 'cancelar')))
        .expect(403);
      expect(await contarEventos()).toBe(antes);
    });

    it('la cita sigue intacta tras los intentos falsos', async () => {
      expect((await cita(a)).estatus).toBe('agendada');
    });
  });

  describe('idempotencia de entrega', () => {
    const payload = { entry: [{ changes: [{ value: { statuses: [] } }] }] };

    it('acepta el evento y lo registra', async () => {
      await postFirmado(payload).expect(200);
      expect(await contarEventos()).toBeGreaterThan(0);
    });

    // Meta reintenta si la respuesta tarda: el mismo cuerpo no debe procesarse
    // dos veces.
    it('el mismo cuerpo repetido no crea una segunda fila', async () => {
      const antes = await contarEventos();
      await postFirmado(payload).expect(200);
      expect(await contarEventos()).toBe(antes);
    });
  });

  describe('el paciente confirma', () => {
    beforeAll(async () => {
      await postFirmado(sobreBoton(a.metaMessageId, 'confirmar')).expect(200);
      await esperarProceso();
    });

    it('marca la cita como confirmada sin cambiar su estatus', async () => {
      const c = await cita(a);
      expect(c.confirmada_at).not.toBeNull();
      // Confirmar es ortogonal al ciclo de vida: la cita sigue agendada y puede
      // seguir su curso normal hasta el check-in.
      expect(c.estatus).toBe('agendada');
    });

    it('deja bitácora atribuida al sistema, no a un usuario', async () => {
      const r = await admin.db.execute(sql`
        SELECT user_id, detalle FROM audit_log
         WHERE tenant_id = ${a.tenantId}::uuid AND accion = 'confirm'
      `);
      const fila = r.rows[0] as { user_id: string | null; detalle: { origen: string } };
      expect(fila).toBeDefined();
      // No lo hizo ningún usuario de la clínica: lo hizo el paciente.
      expect(fila.user_id).toBeNull();
      expect(fila.detalle.origen).toBe('whatsapp');
    });

    // El mismo celular es paciente en las dos clínicas. Si el ruteo fuera por
    // teléfono, esta cita también se habría confirmado.
    it('NO toca la cita de la otra clínica con el mismo teléfono', async () => {
      expect((await cita(b)).confirmada_at).toBeNull();
    });

    it('es idempotente: repetir el botón no cambia la fecha de confirmación', async () => {
      const primera = (await cita(a)).confirmada_at;
      await postFirmado(sobreBoton(a.metaMessageId, 'confirmar')).expect(200);
      await esperarProceso();
      expect((await cita(a)).confirmada_at).toEqual(primera);
    });
  });

  describe('ruteo por id de mensaje', () => {
    it('ignora una respuesta a un mensaje que no conocemos', async () => {
      await postFirmado(sobreBoton('wamid.inventado', 'cancelar')).expect(200);
      await esperarProceso();
      expect((await cita(a)).estatus).toBe('agendada');
      expect((await cita(b)).estatus).toBe('agendada');
    });
  });

  describe('el paciente cancela', () => {
    beforeAll(async () => {
      await postFirmado(sobreBoton(b.metaMessageId, 'cancelar')).expect(200);
      await esperarProceso();
    });

    it('cancela la cita de SU clínica', async () => {
      expect((await cita(b)).estatus).toBe('cancelada');
    });

    it('no toca la cita de la otra clínica', async () => {
      expect((await cita(a)).estatus).toBe('agendada');
    });

    // Se reutiliza CancelAppointmentUseCase completo, así que el médico se
    // entera igual que si hubiera cancelado la recepcionista.
    it('notifica al médico dentro de la app', async () => {
      const r = await admin.db.execute(sql`
        SELECT tipo, user_id FROM notifications
         WHERE tenant_id = ${b.tenantId}::uuid AND tipo = 'cita_cancelada'
      `);
      expect(r.rows).toHaveLength(1);
      expect((r.rows[0] as { user_id: string }).user_id).toBe(b.doctorId);
    });

    it('registra el motivo en la bitácora', async () => {
      const r = await admin.db.execute(sql`
        SELECT detalle FROM audit_log
         WHERE tenant_id = ${b.tenantId}::uuid AND accion = 'cancel'
      `);
      const detalle = (r.rows[0] as { detalle: { motivo: string } }).detalle;
      expect(detalle.motivo).toContain('WhatsApp');
    });
  });

  describe('acuses de entrega', () => {
    const estado = (metaMessageId: string, status: string) => ({
      entry: [{ changes: [{ value: { statuses: [{ id: metaMessageId, status }] } }] }],
    });

    it('avanza enviado → entregado → leído', async () => {
      await postFirmado(estado(a.metaMessageId, 'delivered')).expect(200);
      await esperarProceso();
      expect(await estadoOutbox(a)).toBe('entregado');

      await postFirmado(estado(a.metaMessageId, 'read')).expect(200);
      await esperarProceso();
      expect(await estadoOutbox(a)).toBe('leido');
    });

    // Meta no garantiza el orden de sus webhooks.
    it('un "entregado" que llega tarde no pisa un "leído"', async () => {
      await postFirmado(estado(a.metaMessageId, 'delivered')).expect(200);
      await esperarProceso();
      expect(await estadoOutbox(a)).toBe('leido');
    });
  });

  describe('el paciente pide la baja', () => {
    const baja = (metaMessageId: string, texto: string) => ({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: TELEFONO.replace('+', ''),
                    id: `wamid.baja.${randomUUID()}`,
                    type: 'text',
                    context: { id: metaMessageId },
                    text: { body: texto },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    beforeAll(async () => {
      await postFirmado(baja(a.metaMessageId, 'BAJA')).expect(200);
      await esperarProceso();
    });

    it('apaga el consentimiento del paciente de esa clínica', async () => {
      expect(await optIn(a)).toBe(false);
    });

    // El mismo número sigue siendo paciente de la otra clínica y allí no pidió
    // nada: darlo de baja en las dos sería decidir por él.
    it('NO da de baja al homónimo de la otra clínica', async () => {
      expect(await optIn(b)).toBe(true);
    });
  });

  async function contarEventos(): Promise<number> {
    const r = await admin.db.execute(sql`SELECT count(*)::int AS n FROM whatsapp_events`);
    return (r.rows[0] as { n: number }).n;
  }

  async function estadoOutbox(c: Clinica): Promise<string> {
    const r = await admin.db.execute(
      sql`SELECT estado FROM whatsapp_outbox WHERE id = ${c.outboxId}::uuid`,
    );
    return (r.rows[0] as { estado: string }).estado;
  }

  async function optIn(c: Clinica): Promise<boolean> {
    const r = await admin.db.execute(
      sql`SELECT whatsapp_opt_in FROM patients WHERE id = ${c.pacienteId}::uuid`,
    );
    return (r.rows[0] as { whatsapp_opt_in: boolean }).whatsapp_opt_in;
  }
});
