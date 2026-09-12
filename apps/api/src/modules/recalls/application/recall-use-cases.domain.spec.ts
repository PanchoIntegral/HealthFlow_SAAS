import type { Tx } from '../../../db/drizzle';
import type { AuditEntry, AuditService } from '../../../common/audit/audit.service';
import type { CapacidadService } from '../../../common/capacidad/capacidad.service';
import type { Capacidad } from '../../../common/capacidad/capacidad';
import { ModuloNoDisponibleError } from '../../../common/capacidad/capacidad.errors';
import type { EstadoRecall } from '../domain/recall.entity';
import type {
  ContactoPaciente,
  RecallRepository,
  TipoRecall,
} from '../domain/recall.repository';
import { GenerateRecallFromCompletedTreatmentUseCase } from './recall-asignacion.use-cases';
import {
  RecordRecallOutcomeUseCase,
  ScheduleRecallAttemptUseCase,
} from './recall-contacto.use-cases';
import {
  MatchAppointmentToRecallUseCase,
  UpdateRecallOnAppointmentUseCase,
} from './recall-ciclo.use-cases';
import { ProcessDueRecallsUseCase } from './procesar-vencimientos.use-case';
import { auditar } from './actor';

/**
 * Las RAMAS de decisión de los casos de uso, sin PostgreSQL.
 *
 * Lo que se prueba aquí es lo que una prueba de integración tapa: que un caso
 * de uso NO consulte de más, que se detenga antes de escribir cuando no
 * corresponde, y que enrute la auditoría por la vía correcta. Las invariantes
 * de datos (unicidad, RLS, CHECKs) viven en la suite de integración, que es
 * donde se pueden comprobar de verdad.
 */

const TX = {} as Tx;
const AHORA = new Date('2026-09-12T18:00:00Z');

const TIPO: TipoRecall = {
  id: 't1',
  nombre: 'Limpieza',
  intervalMonths: 6,
  bookingServiceId: 'svc1',
  activo: true,
  autoGenerar: true,
  daysBeforeFirstContact: 0,
  maxAttempts: 3,
  attemptSpacingDays: 7,
};

const CONTACTO: ContactoPaciente = {
  archivado: false,
  email: 'ana@correo.mx',
  emailSuprimido: false,
  telefono: null,
  whatsappOptIn: false,
  canalPreferido: 'email',
};

function estado(over: Partial<EstadoRecall> = {}): EstadoRecall {
  return {
    id: 'r1',
    patientId: 'p1',
    recallTypeId: 't1',
    source: 'manual',
    sourceEntityId: null,
    dueDate: '2026-09-01',
    status: 'due',
    assignedDoctorId: null,
    appointmentId: null,
    lastContactAt: null,
    nextAttemptAt: null,
    completedAt: null,
    dismissReason: null,
    intentos: 0,
    ...over,
  };
}

/** Repositorio falso que además CUENTA qué se le pidió. */
function repoFalso(over: Partial<RecallRepository> = {}) {
  const llamadas: string[] = [];
  const espiar =
    <T>(nombre: string, valor: T) =>
    async (..._args: unknown[]): Promise<T> => {
      llamadas.push(nombre);
      return valor;
    };
  const base = {
    listarTipos: espiar('listarTipos', [] as TipoRecall[]),
    buscarTipo: espiar('buscarTipo', TIPO as TipoRecall | null),
    crearTipo: espiar('crearTipo', TIPO),
    actualizarTipo: espiar('actualizarTipo', TIPO as TipoRecall | null),
    leerConfiguracion: espiar('leerConfiguracion', {
      noShowRecallTypeId: null,
      noShowDelayDays: 1,
    }),
    guardarConfiguracion: espiar('guardarConfiguracion', {
      noShowRecallTypeId: null,
      noShowDelayDays: 1,
    }),
    cargarParaActualizar: espiar('cargarParaActualizar', estado() as EstadoRecall | null),
    insertar: espiar('insertar', true),
    guardar: espiar('guardar', undefined),
    buscarVivosCompatibles: espiar('buscarVivosCompatibles', [] as EstadoRecall[]),
    buscarVivoPorTipo: espiar('buscarVivoPorTipo', null as EstadoRecall | null),
    buscarPorCita: espiar('buscarPorCita', null as EstadoRecall | null),
    crearIntento: espiar('crearIntento', 'a1'),
    encolarMensajeDeIntento: espiar('encolarMensajeDeIntento', true),
    cerrarIntento: espiar('cerrarIntento', undefined),
    cancelarPendientes: espiar('cancelarPendientes', undefined),
    hayIntentoPendiente: espiar('hayIntentoPendiente', false),
    listarWorklist: espiar('listarWorklist', { items: [], nextCursor: null }),
    metricas: espiar('metricas', {
      vencidos: 0, contactados: 0, convertidos: 0, recuperados: 0, agotados: 0,
      medianaDiasHastaReserva: null,
    }),
    contactoDePaciente: espiar('contactoDePaciente', CONTACTO as ContactoPaciente | null),
    zonaHoraria: espiar('zonaHoraria', 'America/Mexico_City'),
    tipoDePartida: espiar('tipoDePartida', null as string | null),
    reclamarVencidos: espiar('reclamarVencidos', [] as string[]),
    reclamarIntentosVencidos: espiar('reclamarIntentosVencidos', [] as string[]),
  } as unknown as RecallRepository;
  return { repo: { ...base, ...over } as RecallRepository, llamadas };
}

function capacidadFalsa(capacidad: Capacidad = { acceso: 'completo' }): CapacidadService {
  return {
    evaluar: async () => capacidad,
    asegurar: async (_tx: Tx, modulo: string) => {
      if (capacidad.acceso === 'completo') return;
      throw new ModuloNoDisponibleError(modulo as 'dental_recalls', capacidad.razon);
    },
  } as unknown as CapacidadService;
}

function auditFalso() {
  const entradas: { via: 'usuario' | 'sistema'; entry: AuditEntry; tenantId?: string }[] = [];
  const audit = {
    record: async (_tx: Tx, entry: AuditEntry) => {
      entradas.push({ via: 'usuario', entry });
    },
    recordSystem: async (_tx: Tx, tenantId: string, entry: AuditEntry) => {
      entradas.push({ via: 'sistema', entry, tenantId });
    },
  } as unknown as AuditService;
  return { audit, entradas };
}

describe('Casos de uso de Recall (ramas de decisión)', () => {
  describe('generar desde un tratamiento terminado', () => {
    it('una partida sin tipo no consulta nada más ni escribe', async () => {
      const { repo, llamadas } = repoFalso();
      const { audit, entradas } = auditFalso();
      const caso = new GenerateRecallFromCompletedTreatmentUseCase(capacidadFalsa(), audit, repo);

      const resultado = await caso.ejecutar(TX, {
        tenantId: 'tn1',
        patientId: 'p1',
        partidaId: 'pa1',
        ocurrioEn: AHORA,
      });

      expect(resultado).toEqual({ recall: null, yaExistia: false });
      // Ni siquiera busca el tipo ni la zona horaria: se detiene en cuanto ve
      // que la partida no declara control.
      expect(llamadas).toEqual(['tipoDePartida']);
      expect(entradas).toHaveLength(0);
    });

    it('con tipo, audita por la vía de SISTEMA y con el tenant del evento', async () => {
      const { repo } = repoFalso({
        tipoDePartida: async () => 't1',
      } as Partial<RecallRepository>);
      const { audit, entradas } = auditFalso();
      const caso = new GenerateRecallFromCompletedTreatmentUseCase(capacidadFalsa(), audit, repo);

      await caso.ejecutar(TX, {
        tenantId: 'tn1',
        patientId: 'p1',
        partidaId: 'pa1',
        ocurrioEn: AHORA,
      });

      // El worker no tiene contexto HTTP: si esto fuera por `record`, la
      // transacción entera fallaría al pedir el usuario de la petición.
      expect(entradas).toHaveLength(1);
      expect(entradas[0]).toMatchObject({ via: 'sistema', tenantId: 'tn1' });
      expect(entradas[0]?.entry.detalle).toMatchObject({ source: 'procedimiento' });
    });

    it('un control ya existente no es un error: devuelve el vivo', async () => {
      const vivo = estado({ id: 'r-viejo' });
      const { repo } = repoFalso({
        tipoDePartida: async () => 't1',
        insertar: async () => false,
        buscarVivoPorTipo: async () => vivo,
      } as Partial<RecallRepository>);
      const { audit, entradas } = auditFalso();
      const caso = new GenerateRecallFromCompletedTreatmentUseCase(capacidadFalsa(), audit, repo);

      const resultado = await caso.ejecutar(TX, {
        tenantId: 'tn1', patientId: 'p1', partidaId: 'pa1', ocurrioEn: AHORA,
      });

      expect(resultado).toEqual({ recall: vivo, yaExistia: true });
      // Y no se audita un alta que no ocurrió.
      expect(entradas).toHaveLength(0);
    });
  });

  describe('vincular una cita', () => {
    it('sin servicio declarado no vincula: exige vínculo manual', async () => {
      const { repo, llamadas } = repoFalso();
      const { audit } = auditFalso();
      const caso = new MatchAppointmentToRecallUseCase(capacidadFalsa(), audit, repo);

      const resultado = await caso.ejecutar(TX, {
        tenantId: 'tn1', patientId: 'p1', appointmentId: 'a1', serviceId: null,
      });

      expect(resultado).toEqual({ vinculado: null });
      expect(llamadas).not.toContain('guardar');
    });

    it('con varios candidatos elige el primero y deja constancia de cuántos había', async () => {
      // El repositorio los devuelve ya ordenados por (due_date, id).
      const candidatos = [estado({ id: 'r-antiguo' }), estado({ id: 'r-reciente' })];
      const { repo } = repoFalso({
        buscarVivosCompatibles: async () => candidatos,
      } as Partial<RecallRepository>);
      const { audit, entradas } = auditFalso();
      const caso = new MatchAppointmentToRecallUseCase(capacidadFalsa(), audit, repo);

      const resultado = await caso.ejecutar(TX, {
        tenantId: 'tn1', patientId: 'p1', appointmentId: 'a1', serviceId: 'svc1',
      });

      expect(resultado).toEqual({ vinculado: 'r-antiguo' });
      expect(entradas[0]?.entry.detalle).toMatchObject({ candidatos: 2 });
    });
  });

  describe('el ciclo de la cita', () => {
    it('sin control vinculado no hace nada', async () => {
      const { repo, llamadas } = repoFalso();
      const { audit, entradas } = auditFalso();
      const caso = new UpdateRecallOnAppointmentUseCase(capacidadFalsa(), audit, repo);

      expect(await caso.reabrir(TX, { tenantId: 'tn1', appointmentId: 'a1' })).toEqual({
        afectado: null,
      });
      expect(llamadas).not.toContain('guardar');
      expect(entradas).toHaveLength(0);
    });

    it('cancelar devuelve a `due`; finalizar completa', async () => {
      const agendado = estado({ status: 'scheduled', appointmentId: 'a1' });
      const guardados: EstadoRecall[] = [];
      const { repo } = repoFalso({
        buscarPorCita: async () => ({ ...agendado }),
        guardar: async (_tx: Tx, e: EstadoRecall) => {
          guardados.push(e);
        },
      } as Partial<RecallRepository>);
      const { audit } = auditFalso();
      const caso = new UpdateRecallOnAppointmentUseCase(capacidadFalsa(), audit, repo);

      await caso.reabrir(TX, { tenantId: 'tn1', appointmentId: 'a1' });
      expect(guardados[0]).toMatchObject({ status: 'due', appointmentId: null });

      await caso.completar(TX, { tenantId: 'tn1', appointmentId: 'a1', ahora: AHORA });
      expect(guardados[1]).toMatchObject({ status: 'completed', completedAt: AHORA });
    });
  });

  describe('programar una gestión', () => {
    it('se detiene si ya hay una gestión en curso, antes de crear nada', async () => {
      const { repo, llamadas } = repoFalso({
        hayIntentoPendiente: async () => true,
      } as Partial<RecallRepository>);
      const { audit } = auditFalso();
      const caso = new ScheduleRecallAttemptUseCase(
        {} as never, capacidadFalsa(), audit, {} as never, repo,
      );

      await expect(
        caso.enTransaccion(TX, 'r1', { tipo: 'usuario' }, 'u1', AHORA),
      ).rejects.toMatchObject({ code: 'IntentoEnCurso' });
      expect(llamadas).not.toContain('crearIntento');
    });

    it('sin canal digital crea una tarea de llamada y NO encola mensaje', async () => {
      // Es lo que permite operar sin Twilio ni dominio de correo verificado.
      const { repo, llamadas } = repoFalso({
        contactoDePaciente: async () => ({
          ...CONTACTO, email: null, canalPreferido: null,
        }),
      } as Partial<RecallRepository>);
      const { audit } = auditFalso();
      const caso = new ScheduleRecallAttemptUseCase(
        {} as never, capacidadFalsa(), audit, {} as never, repo,
      );

      const resultado = await caso.enTransaccion(TX, 'r1', { tipo: 'usuario' }, 'u1', AHORA);

      expect(resultado).toMatchObject({ channel: 'phone', encolado: false });
      expect(llamadas).toContain('crearIntento');
      expect(llamadas).not.toContain('encolarMensajeDeIntento');
    });

    it('un paciente archivado no se contacta por ningún canal', async () => {
      const { repo, llamadas } = repoFalso({
        contactoDePaciente: async () => ({ ...CONTACTO, archivado: true }),
      } as Partial<RecallRepository>);
      const { audit } = auditFalso();
      const caso = new ScheduleRecallAttemptUseCase(
        {} as never, capacidadFalsa(), audit, {} as never, repo,
      );

      await expect(
        caso.enTransaccion(TX, 'r1', { tipo: 'usuario' }, 'u1', AHORA),
      ).rejects.toMatchObject({ code: 'PacienteNoContactable' });
      expect(llamadas).not.toContain('crearIntento');
    });
  });

  describe('registrar el resultado de una gestión', () => {
    /** Caso de uso con un doble que además apunta el ORDEN de las llamadas. */
    function armar(cerrado: boolean) {
      const orden: string[] = [];
      const { repo } = repoFalso({
        cancelarMensajesDeIntento: async () => {
          orden.push('cancelarMensajesDeIntento');
        },
        cerrarIntento: async () => {
          orden.push('cerrarIntento');
          return cerrado;
        },
        cancelarPendientes: async () => {
          orden.push('cancelarPendientes');
        },
        guardar: async () => {
          orden.push('guardar');
        },
      } as Partial<RecallRepository>);
      const { audit, entradas } = auditFalso();
      const tenantDb = { run: async (fn: (tx: Tx) => Promise<unknown>) => fn(TX) };
      return {
        caso: new RecordRecallOutcomeUseCase(
          tenantDb as never, capacidadFalsa(), audit, repo,
        ),
        orden,
        entradas,
      };
    }

    it('cancela el mensaje ANTES de cerrar el intento', async () => {
      // Al revés no funciona: cerrar saca el intento de 'pending' y la
      // cancelación ya no lo encuentra, así que el correo salía igual.
      const { caso, orden } = armar(true);
      await caso.ejecutar({ recallId: 'r1', attemptId: 'a1', resultado: 'declined' });
      expect(orden.indexOf('cancelarMensajesDeIntento')).toBeLessThan(orden.indexOf('cerrarIntento'));
    });

    it('si el cierre no actualizó ninguna fila, falla en vez de devolver éxito', async () => {
      const { caso, orden, entradas } = armar(false);
      await expect(
        caso.ejecutar({ recallId: 'r1', attemptId: 'ajeno', resultado: 'answered' }),
      ).rejects.toMatchObject({ code: 'IntentoNoActualizable' });
      // Y no sigue adelante: ni descarta, ni guarda, ni audita una gestión
      // que no quedó registrada.
      expect(orden).not.toContain('guardar');
      expect(entradas).toHaveLength(0);
    });

    it('declinar descarta el control; no contestar lo deja como estaba', async () => {
      const { caso: declinar, orden: ordenDeclinar } = armar(true);
      await declinar.ejecutar({ recallId: 'r1', attemptId: 'a1', resultado: 'declined' });
      expect(ordenDeclinar).toContain('guardar');

      const { caso: noContesta, orden: ordenNoContesta } = armar(true);
      await noContesta.ejecutar({ recallId: 'r1', attemptId: 'a1', resultado: 'unreachable' });
      // Sigue vivo: aún quedan intentos por hacer.
      expect(ordenNoContesta).not.toContain('guardar');
    });
  });

  describe('barrido de vencimientos', () => {
    it('una clínica sin el módulo disponible no vence nada, y no consulta', async () => {
      const { repo, llamadas } = repoFalso();
      const caso = new ProcessDueRecallsUseCase(
        capacidadFalsa({ acceso: 'ninguno', razon: 'configuracion' }),
        repo,
      );
      expect(await caso.ejecutar(TX, AHORA)).toBe(0);
      expect(llamadas).toEqual([]);
    });

    it('con el pago atrasado tampoco: vencer produce trabajo nuevo', async () => {
      // 'solo_lectura' deja consultar la lista, pero no generar seguimientos.
      const { repo, llamadas } = repoFalso();
      const caso = new ProcessDueRecallsUseCase(
        capacidadFalsa({ acceso: 'solo_lectura', razon: 'suscripcion' }),
        repo,
      );
      expect(await caso.ejecutar(TX, AHORA)).toBe(0);
      expect(llamadas).toEqual([]);
    });

    it('vence sólo los que estaban pendientes', async () => {
      const guardados: EstadoRecall[] = [];
      const { repo } = repoFalso({
        reclamarVencidos: async () => ['r1', 'r2'],
        cargarParaActualizar: async (_tx: Tx, id: string) =>
          id === 'r1' ? estado({ id, status: 'pending' }) : estado({ id, status: 'contacted' }),
        guardar: async (_tx: Tx, e: EstadoRecall) => {
          guardados.push(e);
        },
      } as Partial<RecallRepository>);
      const caso = new ProcessDueRecallsUseCase(capacidadFalsa(), repo);

      expect(await caso.ejecutar(TX, AHORA)).toBe(1);
      expect(guardados).toHaveLength(1);
      expect(guardados[0]).toMatchObject({ id: 'r1', status: 'due' });
    });
  });

  describe('enrutado de la auditoría', () => {
    it('un actor de usuario usa `record`; uno de sistema, `recordSystem`', async () => {
      const { audit, entradas } = auditFalso();
      const entry: AuditEntry = { entidad: 'PatientRecall', accion: 'probar' };

      await auditar(audit, TX, { tipo: 'usuario' }, entry);
      await auditar(audit, TX, { tipo: 'sistema', tenantId: 'tn1', origen: 'worker' }, entry);

      expect(entradas.map((e) => e.via)).toEqual(['usuario', 'sistema']);
      expect(entradas[1]?.tenantId).toBe('tn1');
    });
  });
});
