import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { loadDotEnv } from '../src/config/env';
import { createAdminDb, createAppDb, runInTenant } from '../src/db/drizzle';
import { AppModule } from '../src/app.module';
import { RecordatoriosScheduler } from '../src/modules/whatsapp/infrastructure/recordatorios.scheduler';

loadDotEnv();

const HORA = 60 * 60 * 1000;

/**
 * El barrido de recordatorios: aislamiento multi-tenant e idempotencia.
 *
 * Es el test que justifica todo el diseño del módulo. El job corre FUERA de
 * cualquier petición, así que no hay tenant fijado por el interceptor: si la
 * resolución de clínicas estuviera mal, un paciente de una clínica recibiría el
 * recordatorio de otra, con el nombre de otro médico. Aquí se comprueba que la
 * base no lo permite ni aunque el código quisiera.
 */
describe('Barrido de recordatorios por WhatsApp', () => {
  const admin = createAdminDb();
  const app_ = createAppDb();
  let app: INestApplication;
  let scheduler: RecordatoriosScheduler;

  interface Clinica {
    tenantId: string;
    doctorId: string;
    pacienteId: string;
    citaId: string;
    nombre: string;
  }
  const a: Clinica = nuevaClinica('Clínica Norte');
  const b: Clinica = nuevaClinica('Clínica Sur');

  /**
   * Tiempo REAL, no simulado: las funciones SQL del barrido comparan contra
   * `now()` de Postgres, así que un reloj inventado dejaría todo programado en
   * un futuro que la base nunca alcanzaría dentro del test.
   */
  const AHORA = new Date();
  const EN_20_HORAS = new Date(AHORA.getTime() + 20 * HORA);

  function nuevaClinica(nombre: string): Clinica {
    return {
      tenantId: randomUUID(),
      doctorId: randomUUID(),
      pacienteId: randomUUID(),
      citaId: randomUUID(),
      nombre,
    };
  }

  async function sembrar(c: Clinica, opciones: { optIn: boolean; activo: boolean }) {
    await admin.db.execute(sql`
      INSERT INTO tenants (id, nombre_clinica, plan, subscription_status)
      VALUES (${c.tenantId}::uuid, ${c.nombre}, 'consultorio', 'active')
    `);
    await admin.db.execute(sql`
      INSERT INTO users (id, tenant_id, email, password_hash, nombre, rol, es_medico)
      VALUES (${c.doctorId}::uuid, ${c.tenantId}::uuid, ${`wa-sched-${c.doctorId}@test.mx`},
              'x', ${`Dr. de ${c.nombre}`}, 'admin', true)
    `);
    await admin.db.execute(sql`
      INSERT INTO patients (id, tenant_id, nombre, fecha_nacimiento, telefono,
                            telefono_e164, whatsapp_opt_in, whatsapp_opt_in_at)
      VALUES (${c.pacienteId}::uuid, ${c.tenantId}::uuid, ${`Paciente de ${c.nombre}`},
              '1990-01-01', '5551234567', '+525551234567',
              ${opciones.optIn}, ${opciones.optIn ? AHORA.toISOString() : null}::timestamptz)
    `);
    await admin.db.execute(sql`
      INSERT INTO appointments (id, tenant_id, patient_id, doctor_id, motivo,
                                inicio_programado, fin_programado, estatus)
      VALUES (${c.citaId}::uuid, ${c.tenantId}::uuid, ${c.pacienteId}::uuid, ${c.doctorId}::uuid,
              'Motivo clínico que NUNCA debe salir en el mensaje',
              ${EN_20_HORAS.toISOString()}::timestamptz,
              ${new Date(EN_20_HORAS.getTime() + HORA).toISOString()}::timestamptz, 'agendada')
    `);
    // Silencio desactivado (desde === hasta): si no, el resultado dependería de
    // la hora a la que alguien corra la suite, y de madrugada el envío se
    // empujaría a las 8am y el test fallaría sin que nada esté mal.
    await admin.db.execute(sql`
      INSERT INTO tenant_whatsapp_config (tenant_id, activo, nombre_remitente,
                                          horas_anticipacion, silencio_desde, silencio_hasta)
      VALUES (${c.tenantId}::uuid, ${opciones.activo}, ${c.nombre}, 24, 0, 0)
    `);
  }

  beforeAll(async () => {
    await sembrar(a, { optIn: true, activo: true });
    await sembrar(b, { optIn: true, activo: true });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    scheduler = app.get(RecordatoriosScheduler);
  });

  afterAll(async () => {
    for (const c of [a, b]) {
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
    await app_.pool.end();
  });

  /** Filas del outbox de esa clínica, leídas con privilegios de dueño. */
  async function outbox(c: Clinica) {
    const r = await admin.db.execute(sql`
      SELECT id, tenant_id, patient_id, appointment_id, plantilla, estado,
             meta_message_id, variables, intentos, ultimo_error, programado_para
        FROM whatsapp_outbox WHERE tenant_id = ${c.tenantId}::uuid
       ORDER BY created_at
    `);
    return r.rows as unknown as {
      id: string;
      tenant_id: string;
      patient_id: string;
      appointment_id: string;
      plantilla: string;
      estado: string;
      meta_message_id: string | null;
      variables: Record<string, string>;
      intentos: number;
      ultimo_error: string | null;
      programado_para: Date;
    }[];
  }

  describe('un barrido completo', () => {
    beforeAll(async () => {
      await scheduler.barrer(AHORA);
    });

    it('encola y envía exactamente un recordatorio por clínica', async () => {
      expect(await outbox(a)).toHaveLength(1);
      expect(await outbox(b)).toHaveLength(1);
    });

    it('deja los mensajes enviados, con el id que devolvió el proveedor', async () => {
      const [fila] = await outbox(a);
      expect(fila!.estado).toBe('enviado');
      expect(fila!.meta_message_id).toMatch(/^fake_/);
      expect(fila!.ultimo_error).toBeNull();
    });

    it('cada fila apunta al paciente y a la cita de SU clínica', async () => {
      const [filaA] = await outbox(a);
      const [filaB] = await outbox(b);
      expect(filaA!.patient_id).toBe(a.pacienteId);
      expect(filaA!.appointment_id).toBe(a.citaId);
      expect(filaB!.patient_id).toBe(b.pacienteId);
      expect(filaB!.appointment_id).toBe(b.citaId);
    });

    // Si el ruteo se cruzara, el paciente recibiría el nombre de otra clínica
    // y de otro médico. Es el peor fallo posible de este módulo.
    it('las variables del mensaje llevan los datos de su propia clínica', async () => {
      const [filaA] = await outbox(a);
      const valores = Object.values(filaA!.variables);
      expect(valores).toContain(a.nombre);
      expect(valores).not.toContain(b.nombre);
      expect(valores.some((v) => v.includes('Clínica Sur'))).toBe(false);
    });

    // El mensaje lo puede leer cualquiera que tenga el teléfono en la mano.
    it('NUNCA incluye el motivo de la consulta', async () => {
      for (const c of [a, b]) {
        const [fila] = await outbox(c);
        expect(JSON.stringify(fila!.variables)).not.toContain('Motivo clínico');
      }
    });

    it('programa el envío a la anticipación configurada', async () => {
      const [fila] = await outbox(a);
      // Cita a 20h con anticipación de 24h: el momento ideal ya pasó, así que
      // sale en el primer barrido.
      expect(new Date(fila!.programado_para).getTime()).toBeLessThanOrEqual(AHORA.getTime());
    });
  });

  describe('idempotencia', () => {
    // Lo que impide el duplicado es el índice único (appointment_id, plantilla)
    // más el ON CONFLICT, no una lectura previa: por eso resiste dos barridos.
    it('un segundo barrido no encola nada nuevo', async () => {
      const antes = await outbox(a);
      await scheduler.barrer(new Date(AHORA.getTime() + 60_000));
      const despues = await outbox(a);

      expect(despues).toHaveLength(antes.length);
      expect(despues[0]!.id).toBe(antes[0]!.id);
      expect(despues[0]!.intentos).toBe(antes[0]!.intentos);
    });

    it('la base rechaza un segundo recordatorio para la misma cita', async () => {
      await expect(
        runInTenant(app_.db, a.tenantId, (tx) =>
          tx.execute(sql`
            INSERT INTO whatsapp_outbox (patient_id, appointment_id, plantilla, programado_para)
            VALUES (${a.pacienteId}::uuid, ${a.citaId}::uuid, 'recordatorio_cita', now())
          `),
        ),
      ).rejects.toThrow();
    });
  });

  describe('aislamiento a nivel de base', () => {
    it('con el tenant B fijado, el outbox de A no existe', async () => {
      const visibles = await runInTenant(app_.db, b.tenantId, async (tx) => {
        const r = await tx.execute(sql`SELECT id FROM whatsapp_outbox`);
        return r.rows.length;
      });
      const propias = await outbox(b);
      expect(visibles).toBe(propias.length);
    });

    it('B no puede leer una fila de A ni pidiéndola por id', async () => {
      const [filaA] = await outbox(a);
      const encontradas = await runInTenant(app_.db, b.tenantId, async (tx) => {
        const r = await tx.execute(
          sql`SELECT id FROM whatsapp_outbox WHERE id = ${filaA!.id}::uuid`,
        );
        return r.rows.length;
      });
      expect(encontradas).toBe(0);
    });

    it('B no puede insertar una fila a nombre de A', async () => {
      await expect(
        runInTenant(app_.db, b.tenantId, (tx) =>
          tx.execute(sql`
            INSERT INTO whatsapp_outbox (tenant_id, patient_id, plantilla, programado_para)
            VALUES (${a.tenantId}::uuid, ${b.pacienteId}::uuid, 'recordatorio_cita', now())
          `),
        ),
      ).rejects.toThrow();
    });

    it('sin tenant fijado la cola está vacía', async () => {
      const r = await app_.db.execute(sql`SELECT count(*)::int AS n FROM whatsapp_outbox`);
      expect((r.rows[0] as { n: number }).n).toBe(0);
    });

    // La función definer es la única puerta cross-tenant, y por diseño no
    // entrega datos: solo el par (id, tenant).
    it('whatsapp_reclamar_pendientes solo devuelve identificadores', async () => {
      const r = await app_.db.execute(sql`SELECT * FROM whatsapp_reclamar_pendientes(10)`);
      const columnas = r.fields.map((f) => f.name).sort();
      expect(columnas).toEqual(['outbox_id', 'tenant_id']);
    });
  });

  describe('a quién NO se le manda', () => {
    /** Clínica con el interruptor apagado. */
    const apagada = nuevaClinica('Clínica Apagada');
    /** Clínica encendida pero con un paciente que no dio su consentimiento. */
    const sinPermiso = nuevaClinica('Clínica Sin Permiso');

    beforeAll(async () => {
      await sembrar(apagada, { optIn: true, activo: false });
      await sembrar(sinPermiso, { optIn: false, activo: true });
      await scheduler.barrer(AHORA);
    });

    afterAll(async () => {
      for (const c of [apagada, sinPermiso]) {
        await admin.db.execute(
          sql`DELETE FROM whatsapp_outbox WHERE tenant_id = ${c.tenantId}::uuid`,
        );
        await admin.db.execute(
          sql`DELETE FROM tenant_whatsapp_config WHERE tenant_id = ${c.tenantId}::uuid`,
        );
        await admin.db.execute(sql`DELETE FROM appointments WHERE tenant_id = ${c.tenantId}::uuid`);
        await admin.db.execute(sql`DELETE FROM patients WHERE tenant_id = ${c.tenantId}::uuid`);
        await admin.db.execute(sql`DELETE FROM users WHERE tenant_id = ${c.tenantId}::uuid`);
        await admin.db.execute(sql`DELETE FROM tenants WHERE id = ${c.tenantId}::uuid`);
      }
    });

    it('a la clínica que tiene los recordatorios apagados', async () => {
      expect(await outbox(apagada)).toHaveLength(0);
    });

    // Sin consentimiento explícito no se manda nada, y el filtro vive en el
    // JOIN de la consulta, no en un if que alguien pueda borrar.
    it('al paciente que no dio su consentimiento', async () => {
      expect(await outbox(sinPermiso)).toHaveLength(0);
    });
  });

  describe('el consentimiento se revalida antes de enviar', () => {
    const tardio = nuevaClinica('Clínica Baja Tardía');

    beforeAll(async () => {
      await sembrar(tardio, { optIn: true, activo: true });
      // Se encola con permiso...
      await scheduler.barrer(AHORA);
      // ...y el paciente se da de baja antes de que salga.
      await admin.db.execute(sql`
        UPDATE whatsapp_outbox SET estado = 'pendiente', meta_message_id = NULL, intentos = 0
         WHERE tenant_id = ${tardio.tenantId}::uuid
      `);
      await admin.db.execute(sql`
        UPDATE patients SET whatsapp_opt_in = false WHERE id = ${tardio.pacienteId}::uuid
      `);
      await scheduler.barrer(new Date(AHORA.getTime() + 120_000));
    });

    afterAll(async () => {
      await admin.db.execute(
        sql`DELETE FROM whatsapp_outbox WHERE tenant_id = ${tardio.tenantId}::uuid`,
      );
      await admin.db.execute(
        sql`DELETE FROM tenant_whatsapp_config WHERE tenant_id = ${tardio.tenantId}::uuid`,
      );
      await admin.db.execute(
        sql`DELETE FROM appointments WHERE tenant_id = ${tardio.tenantId}::uuid`,
      );
      await admin.db.execute(sql`DELETE FROM patients WHERE tenant_id = ${tardio.tenantId}::uuid`);
      await admin.db.execute(sql`DELETE FROM users WHERE tenant_id = ${tardio.tenantId}::uuid`);
      await admin.db.execute(sql`DELETE FROM tenants WHERE id = ${tardio.tenantId}::uuid`);
    });

    it('el mensaje ya encolado no sale si el paciente revocó el permiso', async () => {
      const [fila] = await outbox(tardio);
      expect(fila!.estado).toBe('pendiente');
      expect(fila!.meta_message_id).toBeNull();
    });
  });
});
