import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { loadDotEnv } from '../src/config/env';
import { createAdminDb, createAppDb, runInTenant, type Tx } from '../src/db/drizzle';
import { AppModule } from '../src/app.module';
import { RequestContextService } from '../src/common/tenant-context/request-context';
import { AuditService } from '../src/common/audit/audit.service';
import {
  CreateRecallTypeUseCase,
  RecallSettingsUseCases,
  UpdateRecallTypeUseCase,
} from '../src/modules/recalls/application/recall-types.use-cases';
import {
  AssignPatientRecallUseCase,
  GenerateRecallFromCompletedTreatmentUseCase,
  GenerateRecallFromNoShowUseCase,
} from '../src/modules/recalls/application/recall-asignacion.use-cases';
import {
  DismissRecallUseCase,
  RecordRecallOutcomeUseCase,
  ScheduleRecallAttemptUseCase,
} from '../src/modules/recalls/application/recall-contacto.use-cases';
import {
  MatchAppointmentToRecallUseCase,
  UpdateRecallOnAppointmentUseCase,
} from '../src/modules/recalls/application/recall-ciclo.use-cases';
import {
  ListRecallWorklistUseCase,
  RecallMetricsUseCase,
} from '../src/modules/recalls/application/recall-worklist.use-cases';
import { ProcessDueRecallsUseCase } from '../src/modules/recalls/application/procesar-vencimientos.use-case';

loadDotEnv();

/**
 * Los diez casos de uso de Recall contra PostgreSQL real.
 *
 * Se ejercitan a través del contenedor de Nest —no con dobles— porque lo que
 * interesa verificar es justamente lo que un doble ocultaría: el índice único
 * parcial que impide dos controles vivos, la capacidad efectiva, RLS entre dos
 * clínicas y la auditoría sin contexto HTTP.
 */
describe('Casos de uso de Recall', () => {
  const admin = createAdminDb();
  const appDb = createAppDb();
  let app: INestApplication;
  let ctx: RequestContextService;

  const norte = randomUUID();
  const sur = randomUUID();
  const doctor = randomUUID();
  const paciente = randomUUID();
  const pacienteSur = randomUUID();
  let servicio: string;
  let tipoLimpieza: string;

  /** Corre un bloque como si fuera una petición autenticada de Norte. */
  const comoUsuario = <T>(fn: () => Promise<T>, tenant = norte): Promise<T> =>
    ctx.run({ tenantId: tenant, userId: doctor, rol: 'admin' }, fn);

  /** Corre un bloque en la transacción del tenant, como el worker. */
  const comoWorker = <T>(fn: (tx: Tx) => Promise<T>, tenant = norte): Promise<T> =>
    runInTenant(appDb.db, tenant, fn);

  beforeAll(async () => {
    for (const [id, nombre] of [
      [norte, 'Recall Casos Norte'],
      [sur, 'Recall Casos Sur'],
    ] as const) {
      await admin.db.execute(sql`
        INSERT INTO tenants (id, nombre_clinica, plan, subscription_status)
        VALUES (${id}::uuid, ${nombre}, 'clinica', 'active')
      `);
      // El módulo se activa: sin configuración, la capacidad efectiva lo apaga.
      await admin.db.execute(sql`
        INSERT INTO tenant_feature_flags (tenant_id, flag, habilitado, habilitado_at)
        VALUES (${id}::uuid, 'dental_recalls', true, now())
      `);
      await admin.db.execute(sql`
        INSERT INTO booking_settings (tenant_id, slug, timezone)
        VALUES (${id}::uuid, ${`recall-${id.slice(0, 8)}`}, 'America/Mexico_City')
      `);
    }
    await admin.db.execute(sql`
      INSERT INTO users (id, tenant_id, email, password_hash, nombre, rol, es_medico)
      VALUES (${doctor}::uuid, ${norte}::uuid, ${`rcu-${doctor}@test.mx`}, 'x', 'Dra. Norte', 'admin', true)
    `);
    await admin.db.execute(sql`
      INSERT INTO patients (id, tenant_id, nombre, fecha_nacimiento, email, canal_preferido)
      VALUES (${paciente}::uuid, ${norte}::uuid, 'Ana Recall', '1990-01-01', 'ana@correo.mx', 'email'),
             (${pacienteSur}::uuid, ${sur}::uuid, 'Paciente Sur', '1990-01-01', NULL, 'ninguno')
    `);
    const svc = (
      await admin.db.execute(sql`
        INSERT INTO booking_services (tenant_id, nombre, duracion_minutos)
        VALUES (${norte}::uuid, 'Limpieza dental', 30) RETURNING id
      `)
    ).rows[0] as unknown as { id: string };
    servicio = svc.id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    ctx = app.get(RequestContextService);
  });

  afterAll(async () => {
    for (const id of [norte, sur]) {
      await admin.db.execute(sql`
        DELETE FROM outbound_messages WHERE tenant_id=${id}::uuid`);
      await admin.db.execute(sql`DELETE FROM recall_attempts WHERE tenant_id=${id}::uuid`);
      await admin.db.execute(sql`DELETE FROM patient_recalls WHERE tenant_id=${id}::uuid`);
      await admin.db.execute(sql`DELETE FROM recall_settings WHERE tenant_id=${id}::uuid`);
      await admin.db.execute(sql`DELETE FROM presupuesto_partidas WHERE tenant_id=${id}::uuid`);
      await admin.db.execute(sql`DELETE FROM presupuestos WHERE tenant_id=${id}::uuid`);
      await admin.db.execute(sql`DELETE FROM recall_types WHERE tenant_id=${id}::uuid`);
      await admin.db.execute(sql`DELETE FROM appointments WHERE tenant_id=${id}::uuid`);
      await admin.db.execute(sql`DELETE FROM booking_services WHERE tenant_id=${id}::uuid`);
      await admin.db.execute(sql`DELETE FROM booking_settings WHERE tenant_id=${id}::uuid`);
      await admin.db.execute(sql`DELETE FROM audit_log WHERE tenant_id=${id}::uuid`);
      await admin.db.execute(sql`DELETE FROM patients WHERE tenant_id=${id}::uuid`);
      await admin.db.execute(sql`DELETE FROM users WHERE tenant_id=${id}::uuid`);
      await admin.db.execute(sql`DELETE FROM tenant_feature_flags WHERE tenant_id=${id}::uuid`);
      await admin.db.execute(sql`DELETE FROM tenants WHERE id=${id}::uuid`);
    }
    await app?.close();
    await admin.pool.end();
    await appDb.pool.end();
  });

  // ── Catálogo y configuración ───────────────────────────────────
  describe('tipos y configuración', () => {
    it('crea un tipo y lo deja en bitácora', async () => {
      const tipo = await comoUsuario(() =>
        app.get(CreateRecallTypeUseCase).ejecutar({
          nombre: '  Limpieza  ',
          intervalMonths: 6,
          bookingServiceId: servicio,
          maxAttempts: 3,
          attemptSpacingDays: 7,
        }),
      );
      tipoLimpieza = tipo.id;
      expect(tipo.nombre).toBe('Limpieza');
      const bitacora = (
        await admin.db.execute(sql`
          SELECT user_id, accion FROM audit_log
           WHERE tenant_id=${norte}::uuid AND entidad='RecallType'
        `)
      ).rows as unknown as { user_id: string; accion: string }[];
      expect(bitacora).toHaveLength(1);
      expect(bitacora[0]).toMatchObject({ user_id: doctor, accion: 'crear' });
    });

    it('el nombre duplicado lo decide el índice, no una consulta previa', async () => {
      await expect(
        comoUsuario(() =>
          app.get(CreateRecallTypeUseCase).ejecutar({ nombre: 'limpieza', intervalMonths: 3 }),
        ),
      ).rejects.toMatchObject({ code: 'TipoRecallDuplicado' });
    });

    it('actualizar sólo toca lo que se envía', async () => {
      const tipo = await comoUsuario(() =>
        app.get(UpdateRecallTypeUseCase).ejecutar(tipoLimpieza, { maxAttempts: 2 }),
      );
      expect(tipo.maxAttempts).toBe(2);
      expect(tipo.intervalMonths).toBe(6);
      expect(tipo.bookingServiceId).toBe(servicio);
      await comoUsuario(() =>
        app.get(UpdateRecallTypeUseCase).ejecutar(tipoLimpieza, { maxAttempts: 3 }),
      );
    });

    it('no se configura la reactivación con un tipo desactivado', async () => {
      const otro = await comoUsuario(() =>
        app.get(CreateRecallTypeUseCase).ejecutar({ nombre: 'Inactivo', intervalMonths: 12 }),
      );
      await comoUsuario(() =>
        app.get(UpdateRecallTypeUseCase).ejecutar(otro.id, { activo: false }),
      );
      await expect(
        comoUsuario(() =>
          app.get(RecallSettingsUseCases).guardar({
            noShowRecallTypeId: otro.id,
            noShowDelayDays: 2,
          }),
        ),
      ).rejects.toMatchObject({ code: 'TipoRecallInactivo' });
    });

    it('sin configuración, la reactivación está apagada', async () => {
      const config = await comoUsuario(() => app.get(RecallSettingsUseCases).leer());
      expect(config).toEqual({ noShowRecallTypeId: null, noShowDelayDays: 1 });
    });
  });

  // ── Alta de controles ──────────────────────────────────────────
  describe('alta de controles', () => {
    it('asigna un control manual calculando el vencimiento en la zona de la clínica', async () => {
      const { recall, yaExistia } = await comoUsuario(() =>
        app.get(AssignPatientRecallUseCase).ejecutar({
          patientId: paciente,
          recallTypeId: tipoLimpieza,
          desde: '2026-09-12',
          ahora: new Date('2026-09-12T18:00:00Z'),
        }),
      );
      expect(yaExistia).toBe(false);
      expect(recall?.dueDate).toBe('2027-03-12');
      expect(recall?.status).toBe('pending');
    });

    it('dos altas equivalentes dejan UN solo control vivo', async () => {
      const segundo = await comoUsuario(() =>
        app.get(AssignPatientRecallUseCase).ejecutar({
          patientId: paciente,
          recallTypeId: tipoLimpieza,
        }),
      );
      // No es un error: dos eventos distintos pueden pedir lo mismo.
      expect(segundo.yaExistia).toBe(true);
      const vivos = (
        await admin.db.execute(sql`
          SELECT count(*)::int n FROM patient_recalls
           WHERE tenant_id=${norte}::uuid AND patient_id=${paciente}::uuid
             AND status IN ('pending','due','contacted','scheduled')
        `)
      ).rows[0] as unknown as { n: number };
      expect(vivos.n).toBe(1);
    });

    it('una partida SIN tipo no genera nada', async () => {
      const partida = await crearPartida(null);
      const resultado = await comoWorker((tx) =>
        app.get(GenerateRecallFromCompletedTreatmentUseCase).ejecutar(tx, {
          tenantId: norte,
          patientId: pacienteSinControl,
          partidaId: partida,
          ocurrioEn: new Date('2026-09-12T18:00:00Z'),
        }),
      );
      expect(resultado).toEqual({ recall: null, yaExistia: false });
    });

    it('una partida CON tipo genera exactamente un control, fechado por el hecho', async () => {
      const partida = await crearPartida(tipoLimpieza);
      const { recall } = await comoWorker((tx) =>
        app.get(GenerateRecallFromCompletedTreatmentUseCase).ejecutar(tx, {
          tenantId: norte,
          patientId: pacienteSinControl,
          partidaId: partida,
          // El evento se procesa hoy, pero el tratamiento fue hace tres días:
          // el vencimiento cuenta desde el hecho.
          ocurrioEn: new Date('2026-09-09T18:00:00Z'),
        }),
      );
      expect(recall?.dueDate).toBe('2027-03-09');
      expect(recall?.source).toBe('procedimiento');
    });

    it('la auditoría del worker se persiste sin contexto HTTP, con user_id nulo', async () => {
      const filas = (
        await admin.db.execute(sql`
          SELECT user_id, detalle FROM audit_log
           WHERE tenant_id=${norte}::uuid AND entidad='PatientRecall' AND accion='crear'
             AND user_id IS NULL
        `)
      ).rows as unknown as { user_id: null; detalle: Record<string, unknown> }[];
      expect(filas.length).toBeGreaterThan(0);
      expect(filas[0]?.detalle).toMatchObject({ origen: 'worker', source: 'procedimiento' });
    });

    it('un no-show sin configuración NO inventa un tipo', async () => {
      await expect(
        comoWorker((tx) =>
          app.get(GenerateRecallFromNoShowUseCase).ejecutar(tx, {
            tenantId: norte,
            patientId: paciente,
            appointmentId: randomUUID(),
            ocurrioEn: new Date('2026-09-12T18:00:00Z'),
          }),
        ),
      ).rejects.toMatchObject({ code: 'ReactivacionNoConfigurada' });
    });

    it('con configuración, el no-show vence en DÍAS y no en el intervalo del tipo', async () => {
      const tipoReactivacion = await comoUsuario(() =>
        app.get(CreateRecallTypeUseCase).ejecutar({ nombre: 'Reactivación', intervalMonths: 12 }),
      );
      await comoUsuario(() =>
        app.get(RecallSettingsUseCases).guardar({
          noShowRecallTypeId: tipoReactivacion.id,
          noShowDelayDays: 3,
        }),
      );
      const { recall } = await comoWorker((tx) =>
        app.get(GenerateRecallFromNoShowUseCase).ejecutar(tx, {
          tenantId: norte,
          patientId: paciente,
          appointmentId: randomUUID(),
          ocurrioEn: new Date('2026-09-12T18:00:00Z'),
        }),
      );
      // Tres días, no doce meses.
      expect(recall?.dueDate).toBe('2026-09-15');
      expect(recall?.source).toBe('reactivacion');
    });
  });

  // ── Contacto ───────────────────────────────────────────────────
  describe('contacto', () => {
    let recallId: string;

    beforeAll(async () => {
      const fila = (
        await admin.db.execute(sql`
          UPDATE patient_recalls SET status='due'
           WHERE tenant_id=${norte}::uuid AND patient_id=${paciente}::uuid AND status='pending'
          RETURNING id
        `)
      ).rows[0] as unknown as { id: string };
      recallId = fila.id;
    });

    it('elige el canal por consentimiento y encola el envío', async () => {
      const resultado = await comoUsuario(() =>
        app.get(ScheduleRecallAttemptUseCase).ejecutar(recallId, new Date('2026-09-12T18:00:00Z')),
      );
      expect(resultado).toMatchObject({ channel: 'email', encolado: true, status: 'contacted' });

      const mensaje = (
        await admin.db.execute(sql`
          SELECT kind, appointment_id, idempotency_key FROM outbound_messages
           WHERE tenant_id=${norte}::uuid AND recall_attempt_id=${resultado.attemptId}::uuid
        `)
      ).rows[0] as unknown as { kind: string; appointment_id: null; idempotency_key: string };
      // Sujeto polimórfico: un mensaje de recall no cuelga de ninguna cita.
      expect(mensaje).toMatchObject({ kind: 'recall', appointment_id: null });
      expect(mensaje.idempotency_key).toBe(`recall:${recallId}:a1:email`);
    });

    it('dos contactos simultáneos dejan un solo número de intento', async () => {
      const { recallId } = await crearControlVivo();
      const dos = await Promise.allSettled([
        comoUsuario(() => app.get(ScheduleRecallAttemptUseCase).ejecutar(recallId)),
        comoUsuario(() => app.get(ScheduleRecallAttemptUseCase).ejecutar(recallId)),
      ]);
      // Uno gana; el otro ve la gestión en curso y se detiene. Sin esta regla
      // un doble clic le mandaría dos mensajes idénticos al paciente.
      expect(dos.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rechazado = dos.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rechazado.reason).toMatchObject({ code: 'IntentoEnCurso' });
      const intentos = (
        await admin.db.execute(sql`
          SELECT count(*)::int n FROM recall_attempts WHERE patient_recall_id=${recallId}::uuid
        `)
      ).rows[0] as unknown as { n: number };
      expect(intentos.n).toBe(1);
    });

    it('declinar cierra el seguimiento y CANCELA el mensaje que seguía en cola', async () => {
      const { recallId: recall3 } = await crearControlVivo();
      const intento = await comoUsuario(() =>
        app.get(ScheduleRecallAttemptUseCase).ejecutar(recall3),
      );
      const { status } = await comoUsuario(() =>
        app.get(RecordRecallOutcomeUseCase).ejecutar({
          recallId: recall3,
          attemptId: intento.attemptId,
          resultado: 'declined',
        }),
      );
      expect(status).toBe('dismissed');

      // Lo que importa de verdad: el paciente que acaba de rechazar el control
      // NO recibe el correo que seguía en cola para esa misma gestión.
      const mensajes = (
        await admin.db.execute(sql`
          SELECT status FROM outbound_messages WHERE recall_attempt_id=${intento.attemptId}::uuid
        `)
      ).rows as unknown as { status: string }[];
      expect(mensajes).toHaveLength(1);
      expect(mensajes[0]?.status).toBe('cancelled');
    });

    it('un intento de OTRO control del mismo tenant no se puede cerrar desde aquí', async () => {
      // RLS acota al tenant, pero dentro de una clínica no distingue un
      // control de otro: el vínculo lo tiene que exigir la consulta.
      const a = await crearControlVivo();
      const b = await crearControlVivo();
      const intentoDeA = await comoUsuario(() =>
        app.get(ScheduleRecallAttemptUseCase).ejecutar(a.recallId),
      );

      await expect(
        comoUsuario(() =>
          app.get(RecordRecallOutcomeUseCase).ejecutar({
            recallId: b.recallId,
            attemptId: intentoDeA.attemptId,
            resultado: 'answered',
          }),
        ),
      ).rejects.toMatchObject({ code: 'IntentoNoActualizable' });

      // Y el intento de A sigue intacto: ni cerrado ni con resultado ajeno.
      const fila = (
        await admin.db.execute(sql`
          SELECT status, result FROM recall_attempts WHERE id=${intentoDeA.attemptId}::uuid
        `)
      ).rows[0] as unknown as { status: string; result: string | null };
      expect(fila).toMatchObject({ status: 'pending', result: null });
    });

    it('entregar un mensaje NO habilita mandar otro en el acto', async () => {
      // El webhook mueve el intento a 'sent' y con eso cae la barrera de
      // "gestión en curso". Sin el espaciado, recepción podría disparar otro
      // inmediatamente — y no sería una llamada: elegirCanal vuelve a resolver
      // por consentimiento y este paciente tiene correo, así que saldría un
      // segundo correo idéntico minutos después del primero.
      const { recallId } = await crearControlVivo();
      const primero = await comoUsuario(() =>
        app.get(ScheduleRecallAttemptUseCase).ejecutar(recallId, new Date('2026-09-12T18:00:00Z')),
      );
      await admin.db.execute(sql`
        UPDATE recall_attempts SET status='sent', sent_at=now() WHERE id=${primero.attemptId}::uuid
      `);

      const error = await comoUsuario(() =>
        app
          .get(ScheduleRecallAttemptUseCase)
          .ejecutar(recallId, new Date('2026-09-12T18:05:00Z')),
      ).catch((e) => e);
      expect(error).toMatchObject({ code: 'ContactoDemasiadoPronto' });
      // La pantalla necesita saber DESDE CUÁNDO para deshabilitar el botón.
      expect(error.details()).toEqual({ allowedAt: '2026-09-19T18:00:00.000Z' });

      const mensajes = (
        await admin.db.execute(sql`
          SELECT count(*)::int n FROM outbound_messages
           WHERE recall_attempt_id IN (
             SELECT id FROM recall_attempts WHERE patient_recall_id=${recallId}::uuid)
        `)
      ).rows[0] as unknown as { n: number };
      expect(mensajes.n).toBe(1);
    });

    it('al llegar la fecha de separación, el siguiente contacto sí procede', async () => {
      const { recallId } = await crearControlVivo();
      const primero = await comoUsuario(() =>
        app.get(ScheduleRecallAttemptUseCase).ejecutar(recallId, new Date('2026-09-12T18:00:00Z')),
      );
      await admin.db.execute(sql`
        UPDATE recall_attempts SET status='sent', sent_at=now() WHERE id=${primero.attemptId}::uuid
      `);

      // Siete días después, según attempt_spacing_days del tipo.
      const segundo = await comoUsuario(() =>
        app.get(ScheduleRecallAttemptUseCase).ejecutar(recallId, new Date('2026-09-19T18:00:00Z')),
      );
      expect(segundo.attemptId).not.toBe(primero.attemptId);

      const numeros = (
        await admin.db.execute(sql`
          SELECT attempt_number FROM recall_attempts
           WHERE patient_recall_id=${recallId}::uuid ORDER BY attempt_number
        `)
      ).rows as unknown as { attempt_number: number }[];
      expect(numeros.map((n) => n.attempt_number)).toEqual([1, 2]);
    });

    it('el primer contacto no tiene nada que esperar', async () => {
      const { recallId } = await crearControlVivo();
      await expect(
        comoUsuario(() => app.get(ScheduleRecallAttemptUseCase).ejecutar(recallId)),
      ).resolves.toMatchObject({ channel: 'email' });
    });

    it('una gestión YA ENTREGADA sigue pudiendo registrar su resultado', async () => {
      // El webhook mueve el intento a 'sent' en cuanto el proveedor entrega el
      // mensaje (ADR §D8), y es justo entonces cuando el paciente contesta.
      // Admitir sólo 'pending' haría imposible cerrar las gestiones que sí
      // funcionaron.
      const { recallId } = await crearControlVivo();
      const intento = await comoUsuario(() =>
        app.get(ScheduleRecallAttemptUseCase).ejecutar(recallId),
      );
      await admin.db.execute(sql`
        UPDATE recall_attempts SET status='sent', sent_at=now() WHERE id=${intento.attemptId}::uuid
      `);

      await expect(
        comoUsuario(() =>
          app.get(RecordRecallOutcomeUseCase).ejecutar({
            recallId,
            attemptId: intento.attemptId,
            resultado: 'booked',
          }),
        ),
      ).resolves.toBeDefined();

      const fila = (
        await admin.db.execute(sql`
          SELECT status, result FROM recall_attempts WHERE id=${intento.attemptId}::uuid
        `)
      ).rows[0] as unknown as { status: string; result: string };
      expect(fila).toMatchObject({ status: 'closed', result: 'booked' });
    });

    it('una gestión entregada y cerrada no admite un segundo resultado', async () => {
      const { recallId } = await crearControlVivo();
      const intento = await comoUsuario(() =>
        app.get(ScheduleRecallAttemptUseCase).ejecutar(recallId),
      );
      await admin.db.execute(sql`
        UPDATE recall_attempts SET status='sent', sent_at=now() WHERE id=${intento.attemptId}::uuid
      `);
      await comoUsuario(() =>
        app.get(RecordRecallOutcomeUseCase).ejecutar({
          recallId, attemptId: intento.attemptId, resultado: 'answered',
        }),
      );
      await expect(
        comoUsuario(() =>
          app.get(RecordRecallOutcomeUseCase).ejecutar({
            recallId, attemptId: intento.attemptId, resultado: 'booked',
          }),
        ),
      ).rejects.toMatchObject({ code: 'IntentoNoActualizable' });
    });

    it('una gestión cancelada no se resucita con un resultado', async () => {
      const a = await crearControlVivo();
      const intento = await comoUsuario(() =>
        app.get(ScheduleRecallAttemptUseCase).ejecutar(a.recallId),
      );
      await comoUsuario(() => app.get(DismissRecallUseCase).ejecutar(a.recallId, 'Se mudó'));
      await expect(
        comoUsuario(() =>
          app.get(RecordRecallOutcomeUseCase).ejecutar({
            recallId: a.recallId, attemptId: intento.attemptId, resultado: 'answered',
          }),
        ),
      ).rejects.toMatchObject({ code: 'IntentoNoActualizable' });
    });

    it('cerrar dos veces la misma gestión falla la segunda, en vez de reescribir el resultado', async () => {
      const { recallId } = await crearControlVivo();
      const intento = await comoUsuario(() =>
        app.get(ScheduleRecallAttemptUseCase).ejecutar(recallId),
      );
      await comoUsuario(() =>
        app.get(RecordRecallOutcomeUseCase).ejecutar({
          recallId,
          attemptId: intento.attemptId,
          resultado: 'unreachable',
        }),
      );
      await expect(
        comoUsuario(() =>
          app.get(RecordRecallOutcomeUseCase).ejecutar({
            recallId,
            attemptId: intento.attemptId,
            resultado: 'booked',
          }),
        ),
      ).rejects.toMatchObject({ code: 'IntentoNoActualizable' });

      const fila = (
        await admin.db.execute(sql`
          SELECT result FROM recall_attempts WHERE id=${intento.attemptId}::uuid
        `)
      ).rows[0] as unknown as { result: string };
      expect(fila.result).toBe('unreachable');
    });

    it('cancelar lo pendiente de un control no toca el de otro', async () => {
      const a = await crearControlVivo();
      const b = await crearControlVivo();
      const intentoA = await comoUsuario(() =>
        app.get(ScheduleRecallAttemptUseCase).ejecutar(a.recallId),
      );
      const intentoB = await comoUsuario(() =>
        app.get(ScheduleRecallAttemptUseCase).ejecutar(b.recallId),
      );

      await comoUsuario(() => app.get(DismissRecallUseCase).ejecutar(a.recallId, 'Se mudó'));

      const estados = (
        await admin.db.execute(sql`
          SELECT recall_attempt_id, status FROM outbound_messages
           WHERE recall_attempt_id IN (${intentoA.attemptId}::uuid, ${intentoB.attemptId}::uuid)
        `)
      ).rows as unknown as { recall_attempt_id: string; status: string }[];
      const porIntento = new Map(estados.map((e) => [e.recall_attempt_id, e.status]));
      expect(porIntento.get(intentoA.attemptId)).toBe('cancelled');
      expect(porIntento.get(intentoB.attemptId)).toBe('pending');
    });

    it('descartar exige motivo y lo deja en bitácora', async () => {
      const { recallId: recall4 } = await crearControlVivo();
      await expect(
        comoUsuario(() => app.get(DismissRecallUseCase).ejecutar(recall4, '  ')),
      ).rejects.toMatchObject({ code: 'TransicionRecallInvalida' });
      const { status } = await comoUsuario(() =>
        app.get(DismissRecallUseCase).ejecutar(recall4, 'Se mudó de ciudad'),
      );
      expect(status).toBe('dismissed');
    });
  });

  // ── Ciclo con la cita ──────────────────────────────────────────
  describe('ciclo de la cita', () => {
    it('vincula sólo por servicio declarado, y el más antiguo si hay varios', async () => {
      const { recallId, patientId } = await crearControlVivo();
      const cita = await crearCita(patientId);
      const { vinculado } = await comoWorker((tx) =>
        app.get(MatchAppointmentToRecallUseCase).ejecutar(tx, {
          tenantId: norte,
          patientId,
          appointmentId: cita,
          serviceId: servicio,
        }),
      );
      expect(vinculado).toBe(recallId);

      const estado = (
        await admin.db.execute(sql`
          SELECT status, appointment_id FROM patient_recalls WHERE id=${recallId}::uuid
        `)
      ).rows[0] as unknown as { status: string; appointment_id: string };
      expect(estado).toMatchObject({ status: 'scheduled', appointment_id: cita });
    });

    it('una cita sin servicio compatible no vincula nada', async () => {
      const { patientId } = await crearControlVivo();
      const cita = await crearCita(patientId);
      const { vinculado } = await comoWorker((tx) =>
        app.get(MatchAppointmentToRecallUseCase).ejecutar(tx, {
          tenantId: norte,
          patientId,
          // Un tipo sin servicio declarado exige vínculo manual: adivinar
          // cerraría el control equivocado y la conversión mentiría.
          serviceId: null,
          appointmentId: cita,
        }),
      );
      expect(vinculado).toBeNull();
    });

    it('cancelar devuelve el control a due; finalizar lo completa', async () => {
      const { recallId, patientId } = await crearControlVivo();
      const cita = await crearCita(patientId);
      await comoWorker((tx) =>
        app.get(MatchAppointmentToRecallUseCase).ejecutar(tx, {
          tenantId: norte,
          patientId,
          appointmentId: cita,
          serviceId: servicio,
        }),
      );
      await comoWorker((tx) =>
        app.get(UpdateRecallOnAppointmentUseCase).reabrir(tx, { tenantId: norte, appointmentId: cita }),
      );
      let fila = (
        await admin.db.execute(sql`SELECT status FROM patient_recalls WHERE id=${recallId}::uuid`)
      ).rows[0] as unknown as { status: string };
      expect(fila.status).toBe('due');

      const cita2 = await crearCita(patientId);
      await comoWorker((tx) =>
        app.get(MatchAppointmentToRecallUseCase).ejecutar(tx, {
          tenantId: norte,
          patientId,
          appointmentId: cita2,
          serviceId: servicio,
        }),
      );
      await comoWorker((tx) =>
        app.get(UpdateRecallOnAppointmentUseCase).completar(tx, {
          tenantId: norte,
          appointmentId: cita2,
          ahora: new Date('2026-09-12T20:00:00Z'),
        }),
      );
      fila = (
        await admin.db.execute(sql`SELECT status FROM patient_recalls WHERE id=${recallId}::uuid`)
      ).rows[0] as unknown as { status: string };
      expect(fila.status).toBe('completed');
    });
  });

  // ── Worklist, métricas y barrido ───────────────────────────────
  describe('consultas y barrido', () => {
    it('el worklist pagina con cursor estable', async () => {
      const primera = await comoUsuario(() =>
        app.get(ListRecallWorklistUseCase).ejecutar({ limit: 1 }),
      );
      expect(primera.items).toHaveLength(1);
      expect(primera.items[0]?.patientNombre).toBeDefined();
      if (primera.nextCursor) {
        const segunda = await comoUsuario(() =>
          app.get(ListRecallWorklistUseCase).ejecutar({ limit: 1, cursor: primera.nextCursor }),
        );
        expect(segunda.items[0]?.id).not.toBe(primera.items[0]?.id);
      }
    });

    it('las métricas cuentan controles y pacientes, nunca mensajes', async () => {
      const metricas = await comoUsuario(() =>
        app.get(RecallMetricsUseCase).ejecutar('2026-01-01', '2027-12-31'),
      );
      expect(metricas.contactados).toBeGreaterThan(0);
      expect(metricas.recuperados).toBeGreaterThan(0);
      const mensajes = (
        await admin.db.execute(sql`
          SELECT count(*)::int n FROM outbound_messages WHERE tenant_id=${norte}::uuid
        `)
      ).rows[0] as unknown as { n: number };
      // Hay más mensajes que controles contactados: si la métrica contara
      // envíos, un paciente insistido tres veces valdría por tres.
      expect(metricas.contactados).toBeLessThanOrEqual(mensajes.n);
    });

    it('el barrido vence los controles cuya fecha llegó, y es idempotente', async () => {
      const { recallId } = await crearControlVivo('2026-09-01');
      const primera = await comoWorker((tx) =>
        app.get(ProcessDueRecallsUseCase).ejecutar(tx, new Date('2026-09-12T18:00:00Z')),
      );
      expect(primera).toBeGreaterThanOrEqual(1);
      const segunda = await comoWorker((tx) =>
        app.get(ProcessDueRecallsUseCase).ejecutar(tx, new Date('2026-09-12T18:00:00Z')),
      );
      expect(segunda).toBe(0);
      const fila = (
        await admin.db.execute(sql`SELECT status FROM patient_recalls WHERE id=${recallId}::uuid`)
      ).rows[0] as unknown as { status: string };
      expect(fila.status).toBe('due');
    });

    it('una clínica con el módulo apagado no vence nada', async () => {
      await admin.db.execute(sql`
        UPDATE tenant_feature_flags SET habilitado=false
         WHERE tenant_id=${norte}::uuid AND flag='dental_recalls'
      `);
      const vencidos = await comoWorker((tx) =>
        app.get(ProcessDueRecallsUseCase).ejecutar(tx, new Date('2030-01-01T18:00:00Z')),
      );
      expect(vencidos).toBe(0);
      await admin.db.execute(sql`
        UPDATE tenant_feature_flags SET habilitado=true
         WHERE tenant_id=${norte}::uuid AND flag='dental_recalls'
      `);
    });

    it('y con el módulo apagado tampoco se escribe por API', async () => {
      await admin.db.execute(sql`
        UPDATE tenant_feature_flags SET habilitado=false
         WHERE tenant_id=${norte}::uuid AND flag='dental_recalls'
      `);
      await expect(
        comoUsuario(() =>
          app.get(CreateRecallTypeUseCase).ejecutar({ nombre: 'Apagado', intervalMonths: 6 }),
        ),
      ).rejects.toMatchObject({ code: 'ModuloNoDisponible' });
      await admin.db.execute(sql`
        UPDATE tenant_feature_flags SET habilitado=true
         WHERE tenant_id=${norte}::uuid AND flag='dental_recalls'
      `);
    });
  });

  // ── Aislamiento ────────────────────────────────────────────────
  it('RLS impide ver o tocar los controles de la otra clínica', async () => {
    const desdeSur = await comoUsuario(
      () => app.get(ListRecallWorklistUseCase).ejecutar({ limit: 50 }),
      sur,
    );
    expect(desdeSur.items).toHaveLength(0);

    const alguno = (
      await admin.db.execute(sql`
        SELECT id FROM patient_recalls WHERE tenant_id=${norte}::uuid LIMIT 1
      `)
    ).rows[0] as unknown as { id: string };
    await expect(
      comoUsuario(() => app.get(DismissRecallUseCase).ejecutar(alguno.id, 'intruso'), sur),
    ).rejects.toMatchObject({ code: 'RecallNoEncontrado' });
  });

  // ── Utilidades ─────────────────────────────────────────────────
  const pacienteSinControl = randomUUID();

  beforeAll(async () => {
    await admin.db.execute(sql`
      INSERT INTO patients (id, tenant_id, nombre, fecha_nacimiento, canal_preferido)
      VALUES (${pacienteSinControl}::uuid, ${norte}::uuid, 'Beto Recall', '1985-05-05', 'email')
    `);
  });

  async function crearPartida(recallTypeId: string | null): Promise<string> {
    const presupuesto = randomUUID();
    await admin.db.execute(sql`
      INSERT INTO presupuestos (id, tenant_id, patient_id, doctor_id, titulo, estatus)
      VALUES (${presupuesto}::uuid, ${norte}::uuid, ${pacienteSinControl}::uuid, ${doctor}::uuid,
              'Plan de prueba', 'borrador')
    `);
    const fila = (
      await admin.db.execute(sql`
        INSERT INTO presupuesto_partidas
          (tenant_id, presupuesto_id, descripcion, piezas, fase, cantidad,
           valor_unitario_centavos, estatus, recall_type_id, orden)
        VALUES (${norte}::uuid, ${presupuesto}::uuid, 'Limpieza', '{}', 1, 1, 50000,
                'terminado', ${recallTypeId}::uuid, 0)
        RETURNING id
      `)
    ).rows[0] as unknown as { id: string };
    return fila.id;
  }

  /** Un control vivo nuevo, con su propio paciente para no chocar con el índice. */
  async function crearControlVivo(
    dueDate = '2027-06-01',
  ): Promise<{ recallId: string; patientId: string }> {
    const otro = randomUUID();
    await admin.db.execute(sql`
      INSERT INTO patients (id, tenant_id, nombre, fecha_nacimiento, email, canal_preferido)
      VALUES (${otro}::uuid, ${norte}::uuid, ${`Paciente ${otro.slice(0, 6)}`}, '1990-01-01',
              ${`p${otro.slice(0, 6)}@correo.mx`}, 'email')
    `);
    const fila = (
      await admin.db.execute(sql`
        INSERT INTO patient_recalls (tenant_id, patient_id, recall_type_id, source, due_date, status)
        VALUES (${norte}::uuid, ${otro}::uuid, ${tipoLimpieza}::uuid, 'manual', ${dueDate}::date,
                ${dueDate <= '2026-09-12' ? 'pending' : 'due'})
        RETURNING id
      `)
    ).rows[0] as unknown as { id: string };
    return { recallId: fila.id, patientId: otro };
  }

  /**
   * Cada cita va en su propia hora: la restricción de traslape del médico
   * (0035) es real y rechazaría dos citas en el mismo hueco.
   */
  let horaLibre = 0;
  async function crearCita(patientId: string): Promise<string> {
    const desplazamiento = `${7 * 24 + horaLibre++} hours`;
    const fila = (
      await admin.db.execute(sql`
        INSERT INTO appointments (tenant_id, patient_id, doctor_id, service_id,
                                  inicio_programado, fin_programado, estatus)
        VALUES (${norte}::uuid, ${patientId}::uuid, ${doctor}::uuid, ${servicio}::uuid,
                now() + ${desplazamiento}::interval,
                now() + ${desplazamiento}::interval + interval '30 minutes', 'agendada')
        RETURNING id
      `)
    ).rows[0] as unknown as { id: string };
    return fila.id;
  }
});
