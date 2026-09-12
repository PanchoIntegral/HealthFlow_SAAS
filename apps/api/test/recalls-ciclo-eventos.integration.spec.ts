import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { loadDotEnv } from '../src/config/env';
import { createAdminDb, createAppDb, runInTenant, type Tx } from '../src/db/drizzle';
import { AppModule } from '../src/app.module';
import { RequestContextService } from '../src/common/tenant-context/request-context';
import { AppEventsService } from '../src/common/events/app-events.service';
import { AppEventsDispatcher } from '../src/common/events/app-events.dispatcher';
import { MarcarNoAsistioUseCase } from '../src/modules/appointments/application/marcar-no-asistio.use-case';
import { CreateRecallTypeUseCase, RecallSettingsUseCases } from '../src/modules/recalls/application/recall-types.use-cases';

loadDotEnv();

/**
 * El ciclo completo de Recall a través del BUS DE EVENTOS.
 *
 * A diferencia de `recalls-casos-de-uso`, aquí nadie llama a los casos de uso
 * directamente: se emiten eventos y se corre el despachador, que es el camino
 * real. Lo que se verifica es lo que sólo se ve así — que reprocesar un evento
 * no duplique efectos, que una reserva pública cierre el seguimiento, y que
 * reprogramar NO lo reabra.
 */
describe('Ciclo de Recall por eventos', () => {
  const admin = createAdminDb();
  const appDb = createAppDb();
  let app: INestApplication;
  let ctx: RequestContextService;
  let eventos: AppEventsService;
  let dispatcher: AppEventsDispatcher;

  const tenant = randomUUID();
  const doctor = randomUUID();
  const paciente = randomUUID();
  let servicio: string;
  let tipo: string;

  const comoUsuario = <T>(fn: () => Promise<T>): Promise<T> =>
    ctx.run({ tenantId: tenant, userId: doctor, rol: 'admin' }, fn);
  const enTenant = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> =>
    runInTenant(appDb.db, tenant, fn);

  beforeAll(async () => {
    await admin.db.execute(sql`
      INSERT INTO tenants (id, nombre_clinica, plan, subscription_status)
      VALUES (${tenant}::uuid, 'Ciclo Recall', 'clinica', 'active')
    `);
    await admin.db.execute(sql`
      INSERT INTO tenant_feature_flags (tenant_id, flag, habilitado, habilitado_at)
      VALUES (${tenant}::uuid, 'dental_recalls', true, now())
    `);
    await admin.db.execute(sql`
      INSERT INTO booking_settings (tenant_id, slug, timezone)
      VALUES (${tenant}::uuid, ${`ciclo-${tenant.slice(0, 8)}`}, 'America/Mexico_City')
    `);
    await admin.db.execute(sql`
      INSERT INTO users (id, tenant_id, email, password_hash, nombre, rol, es_medico)
      VALUES (${doctor}::uuid, ${tenant}::uuid, ${`cr-${doctor}@test.mx`}, 'x', 'Dra. Ciclo', 'admin', true)
    `);
    await admin.db.execute(sql`
      INSERT INTO patients (id, tenant_id, nombre, fecha_nacimiento, email, canal_preferido)
      VALUES (${paciente}::uuid, ${tenant}::uuid, 'Ana Ciclo', '1990-01-01', 'ana.ciclo@correo.mx', 'email')
    `);
    servicio = (
      (await admin.db.execute(sql`
        INSERT INTO booking_services (tenant_id, nombre, duracion_minutos)
        VALUES (${tenant}::uuid, 'Limpieza', 30) RETURNING id
      `)).rows[0] as unknown as { id: string }
    ).id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    ctx = app.get(RequestContextService);
    eventos = app.get(AppEventsService);
    dispatcher = app.get(AppEventsDispatcher);

    tipo = (
      await comoUsuario(() =>
        app.get(CreateRecallTypeUseCase).ejecutar({
          nombre: 'Limpieza',
          intervalMonths: 6,
          bookingServiceId: servicio,
        }),
      )
    ).id;
  });

  afterAll(async () => {
    await admin.db.execute(sql`DELETE FROM app_event_consumptions WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM app_events WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM outbound_messages WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM recall_attempts WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM patient_recalls WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM recall_settings WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM presupuesto_partidas WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM presupuestos WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM recall_types WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM appointments WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM booking_services WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM booking_settings WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM audit_log WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM patients WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM users WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM tenant_feature_flags WHERE tenant_id=${tenant}::uuid`);
    await admin.db.execute(sql`DELETE FROM tenants WHERE id=${tenant}::uuid`);
    await app?.close();
    await admin.pool.end();
    await appDb.pool.end();
  });

  /** Estado actual de los controles del paciente. */
  async function controles() {
    return (
      await admin.db.execute(sql`
        SELECT id, status, appointment_id, source FROM patient_recalls
         WHERE tenant_id=${tenant}::uuid ORDER BY created_at
      `)
    ).rows as unknown as { id: string; status: string; appointment_id: string | null; source: string }[];
  }

  let horaLibre = 0;
  async function crearCita(estatus = 'agendada'): Promise<string> {
    const desplazamiento = `${7 * 24 + horaLibre++} hours`;
    return (
      (await admin.db.execute(sql`
        INSERT INTO appointments (tenant_id, patient_id, doctor_id, service_id,
                                  inicio_programado, fin_programado, estatus)
        VALUES (${tenant}::uuid, ${paciente}::uuid, ${doctor}::uuid, ${servicio}::uuid,
                now() + ${desplazamiento}::interval,
                now() + ${desplazamiento}::interval + interval '30 minutes', ${estatus})
        RETURNING id
      `)).rows[0] as unknown as { id: string }
    ).id;
  }

  async function crearPartida(): Promise<string> {
    const presupuesto = randomUUID();
    await admin.db.execute(sql`
      INSERT INTO presupuestos (id, tenant_id, patient_id, doctor_id, titulo, estatus)
      VALUES (${presupuesto}::uuid, ${tenant}::uuid, ${paciente}::uuid, ${doctor}::uuid, 'Plan', 'borrador')
    `);
    return (
      (await admin.db.execute(sql`
        INSERT INTO presupuesto_partidas
          (tenant_id, presupuesto_id, descripcion, piezas, fase, cantidad,
           valor_unitario_centavos, estatus, recall_type_id, orden)
        VALUES (${tenant}::uuid, ${presupuesto}::uuid, 'Limpieza', '{}', 1, 1, 50000,
                'terminado', ${tipo}::uuid, 0)
        RETURNING id
      `)).rows[0] as unknown as { id: string }
    ).id;
  }

  describe('un tratamiento terminado abre el ciclo', () => {
    let partidaId: string;

    it('el evento crea el control, pasando por el despachador', async () => {
      partidaId = await crearPartida();
      await enTenant((tx) =>
        eventos.emitir(tx, {
          tipo: 'treatment_item.completed',
          entidad: 'presupuesto_partida',
          entidadId: partidaId,
          payload: { patientId: paciente, doctorId: doctor, recallTypeId: tipo },
        }),
      );
      await dispatcher.tick();

      const filas = await controles();
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({ source: 'procedimiento', appointment_id: null });
    });

    it('reprocesar el MISMO evento no duplica nada', async () => {
      // La consumición ya está en 'done': el reclamo ni siquiera lo devuelve.
      await dispatcher.tick();
      await dispatcher.tick();
      expect(await controles()).toHaveLength(1);
    });

    it('otro evento distinto tampoco crea un segundo control equivalente', async () => {
      // Dos limpiezas terminadas el mismo día: eventos distintos, mismo
      // paciente y tipo. Lo ataja el índice único parcial, no el bus.
      await enTenant((tx) =>
        eventos.emitir(tx, {
          tipo: 'treatment_item.completed',
          entidad: 'presupuesto_partida',
          entidadId: partidaId,
          payload: { patientId: paciente, doctorId: doctor, recallTypeId: tipo },
        }),
      );
      await dispatcher.tick();
      expect(await controles()).toHaveLength(1);
    });
  });

  describe('la cita cierra y reabre el ciclo', () => {
    let citaId: string;

    it('una reserva con servicio compatible lo marca scheduled', async () => {
      citaId = await crearCita();
      await enTenant((tx) =>
        eventos.emitir(tx, {
          tipo: 'appointment.scheduled',
          entidad: 'appointment',
          entidadId: citaId,
          payload: { patientId: paciente, doctorId: doctor, serviceId: servicio, origen: 'publico' },
        }),
      );
      await dispatcher.tick();

      const [control] = await controles();
      expect(control).toMatchObject({ status: 'scheduled', appointment_id: citaId });
    });

    it('reprogramarla CONSERVA el vínculo y no reabre el seguimiento', async () => {
      // Un solo evento. Si esto emitiera cancelación + alta, el consumidor de
      // cancelaciones reabriría un control cuya cita sigue en pie.
      await enTenant((tx) =>
        eventos.emitir(tx, {
          tipo: 'appointment.rescheduled',
          entidad: 'appointment',
          entidadId: citaId,
          payload: {
            patientId: paciente,
            doctorId: doctor,
            inicioAnterior: '2026-09-19T18:00:00.000Z',
            inicioNuevo: '2026-09-26T18:00:00.000Z',
          },
        }),
      );
      await dispatcher.tick();

      const [control] = await controles();
      expect(control).toMatchObject({ status: 'scheduled', appointment_id: citaId });
    });

    it('cancelarla lo devuelve a due y suelta la cita', async () => {
      await enTenant((tx) =>
        eventos.emitir(tx, {
          tipo: 'appointment.cancelled',
          entidad: 'appointment',
          entidadId: citaId,
          payload: { patientId: paciente, doctorId: doctor },
        }),
      );
      await dispatcher.tick();

      const [control] = await controles();
      expect(control).toMatchObject({ status: 'due', appointment_id: null });
    });

    it('finalizar la cita vinculada cierra el ciclo', async () => {
      const otra = await crearCita();
      await enTenant((tx) =>
        eventos.emitir(tx, {
          tipo: 'appointment.scheduled',
          entidad: 'appointment',
          entidadId: otra,
          payload: { patientId: paciente, doctorId: doctor, serviceId: servicio },
        }),
      );
      await dispatcher.tick();
      await enTenant((tx) =>
        eventos.emitir(tx, {
          tipo: 'appointment.completed',
          entidad: 'appointment',
          entidadId: otra,
          payload: { patientId: paciente, doctorId: doctor },
        }),
      );
      await dispatcher.tick();

      const [control] = await controles();
      expect(control?.status).toBe('completed');
    });
  });

  describe('inasistencia', () => {
    it('sin reactivación configurada, el evento se consume sin crear nada', async () => {
      // Es una decisión de la clínica, no un fallo: reintentarlo ocho veces
      // llenaría las alertas de algo que está bien.
      const antes = (await controles()).length;
      const cita = await crearCita();
      await enTenant((tx) =>
        eventos.emitir(tx, {
          tipo: 'appointment.no_show',
          entidad: 'appointment',
          entidadId: cita,
          payload: { patientId: paciente, doctorId: doctor },
        }),
      );
      await dispatcher.tick();

      expect(await controles()).toHaveLength(antes);
      const consumo = (
        await admin.db.execute(sql`
          SELECT status FROM app_event_consumptions c
            JOIN app_events e ON e.id=c.event_id
           WHERE e.entidad_id=${cita}::uuid AND c.consumer='recalls.reactivar.no_show.v1'
        `)
      ).rows[0] as unknown as { status: string };
      expect(consumo.status).toBe('done');
    });

    it('configurada, el evento abre el seguimiento de reactivación', async () => {
      const tipoReact = await comoUsuario(() =>
        app.get(CreateRecallTypeUseCase).ejecutar({ nombre: 'Reactivación', intervalMonths: 12 }),
      );
      await comoUsuario(() =>
        app.get(RecallSettingsUseCases).guardar({
          noShowRecallTypeId: tipoReact.id,
          noShowDelayDays: 2,
        }),
      );
      const cita = await crearCita();
      await enTenant((tx) =>
        eventos.emitir(tx, {
          tipo: 'appointment.no_show',
          entidad: 'appointment',
          entidadId: cita,
          payload: { patientId: paciente, doctorId: doctor },
        }),
      );
      await dispatcher.tick();

      const reactivacion = (await controles()).find((c) => c.source === 'reactivacion');
      expect(reactivacion).toBeDefined();
    });
  });

  describe('marcar la ausencia', () => {
    it('antes de la tolerancia falla y NO muta la cita, ni emite evento', async () => {
      const cita = await crearCita();
      const eventosAntes = (
        await admin.db.execute(sql`
          SELECT count(*)::int n FROM app_events
           WHERE tenant_id=${tenant}::uuid AND tipo='appointment.no_show'
        `)
      ).rows[0] as unknown as { n: number };

      const error = await comoUsuario(() =>
        app.get(MarcarNoAsistioUseCase).execute(cita, new Date()),
      ).catch((e) => e);
      expect(error).toMatchObject({ code: 'AusenciaPrematura' });
      expect(error.details().allowedAt).toBeDefined();

      const fila = (
        await admin.db.execute(sql`SELECT estatus FROM appointments WHERE id=${cita}::uuid`)
      ).rows[0] as unknown as { estatus: string };
      expect(fila.estatus).toBe('agendada');

      const eventosDespues = (
        await admin.db.execute(sql`
          SELECT count(*)::int n FROM app_events
           WHERE tenant_id=${tenant}::uuid AND tipo='appointment.no_show'
        `)
      ).rows[0] as unknown as { n: number };
      expect(eventosDespues.n).toBe(eventosAntes.n);
    });

    it('pasada la tolerancia, marca la ausencia y emite el evento', async () => {
      const cita = await crearCita();
      const fin = (
        await admin.db.execute(sql`SELECT fin_programado FROM appointments WHERE id=${cita}::uuid`)
      ).rows[0] as unknown as { fin_programado: Date | string };
      const despues = new Date(new Date(fin.fin_programado).getTime() + 31 * 60_000);

      await comoUsuario(() => app.get(MarcarNoAsistioUseCase).execute(cita, despues));

      const fila = (
        await admin.db.execute(sql`SELECT estatus FROM appointments WHERE id=${cita}::uuid`)
      ).rows[0] as unknown as { estatus: string };
      expect(fila.estatus).toBe('no_asistio');

      const evento = (
        await admin.db.execute(sql`
          SELECT tipo FROM app_events
           WHERE tenant_id=${tenant}::uuid AND entidad_id=${cita}::uuid
        `)
      ).rows[0] as unknown as { tipo: string };
      expect(evento.tipo).toBe('appointment.no_show');
    });
  });
});
