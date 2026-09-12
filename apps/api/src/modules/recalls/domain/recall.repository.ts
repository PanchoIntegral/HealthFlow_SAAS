import type {
  RecallAttemptResult,
  RecallChannel,
  RecallSource,
  RecallStatus,
} from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import type { EstadoRecall } from './recall.entity';

/**
 * Puerto de persistencia de Recall. El dominio y los casos de uso hablan este
 * lenguaje; el SQL vive en el adaptador Drizzle y en ningún otro sitio.
 *
 * Todos los métodos reciben la transacción del caso de uso: es quien controla
 * los límites transaccionales, no el repositorio. Y ninguno recibe `tenantId`
 * — el tenant lo fija RLS a partir del contexto, nunca un parámetro que un
 * caller pueda equivocar.
 */
export const RECALL_REPOSITORY = Symbol('RECALL_REPOSITORY');

export interface TipoRecall {
  id: string;
  nombre: string;
  intervalMonths: number;
  bookingServiceId: string | null;
  activo: boolean;
  autoGenerar: boolean;
  daysBeforeFirstContact: number;
  maxAttempts: number;
  attemptSpacingDays: number;
}

export interface NuevoTipoRecall {
  nombre: string;
  intervalMonths: number;
  bookingServiceId?: string | null;
  autoGenerar?: boolean;
  daysBeforeFirstContact?: number;
  maxAttempts?: number;
  attemptSpacingDays?: number;
}

export type CambiosTipoRecall = Partial<NuevoTipoRecall & { activo: boolean }>;

export interface ConfiguracionRecall {
  noShowRecallTypeId: string | null;
  noShowDelayDays: number;
}

/** Datos del paciente que el dominio necesita para elegir canal. */
export interface ContactoPaciente {
  archivado: boolean;
  email: string | null;
  emailSuprimido: boolean;
  telefono: string | null;
  whatsappOptIn: boolean;
  canalPreferido: 'whatsapp' | 'email' | 'ninguno' | null;
}

export interface FilaWorklist {
  id: string;
  patientId: string;
  patientNombre: string;
  tipoId: string;
  tipoNombre: string;
  dueDate: string;
  status: RecallStatus;
  assignedDoctorId: string | null;
  assignedDoctorNombre: string | null;
  lastContactAt: string | null;
  nextAttemptAt: string | null;
  intentos: number;
  canalDisponible: RecallChannel;
}

export interface FiltrosWorklist {
  status?: RecallStatus[];
  dueFrom?: string;
  dueTo?: string;
  doctorId?: string;
  q?: string;
  /** Cursor `(due_date, id)` codificado. */
  cursor?: string | null;
  limit: number;
}

export interface PaginaWorklist {
  items: FilaWorklist[];
  nextCursor: string | null;
}

/**
 * ⚠️ Parcialmente no publicable: ver RecallMetricsUseCase. `vencidos` y
 * `contactados` son correctos; el resto se fecha con una columna mutable y
 * necesita fechas inmutables de transición antes de salir a pantalla.
 */
export interface MetricasRecall {
  /** Controles vencidos sin cerrar. Recalls, NO mensajes. */
  vencidos: number;
  /** Controles ÚNICOS con al menos un intento en el periodo. */
  contactados: number;
  /** Controles que llegaron a `scheduled` en el periodo. */
  convertidos: number;
  /** Pacientes ÚNICOS cuya cita vinculada terminó. */
  recuperados: number;
  agotados: number;
  /** Días medianos entre el primer contacto y la reserva. `null` si no hay. */
  medianaDiasHastaReserva: number | null;
}

export interface NuevoMensajeDeIntento {
  recallAttemptId: string;
  patientId: string;
  channel: 'email' | 'whatsapp';
  idempotencyKey: string;
  scheduledAt: Date;
}

export interface NuevoIntento {
  patientRecallId: string;
  channel: RecallChannel;
  attemptNumber: number;
  scheduledAt: Date;
  createdBy: string | null;
}

export interface RecallRepository {
  // ── Catálogo de tipos ──
  listarTipos(tx: Tx, soloActivos?: boolean): Promise<TipoRecall[]>;
  buscarTipo(tx: Tx, id: string): Promise<TipoRecall | null>;
  crearTipo(tx: Tx, input: NuevoTipoRecall): Promise<TipoRecall>;
  actualizarTipo(tx: Tx, id: string, cambios: CambiosTipoRecall): Promise<TipoRecall | null>;

  // ── Configuración de automatización ──
  leerConfiguracion(tx: Tx): Promise<ConfiguracionRecall>;
  guardarConfiguracion(tx: Tx, input: ConfiguracionRecall): Promise<ConfiguracionRecall>;

  // ── Controles ──
  /** Bloquea la fila: quien la carga así va a escribirla en esta transacción. */
  cargarParaActualizar(tx: Tx, id: string): Promise<EstadoRecall | null>;
  /**
   * Devuelve `false` cuando ya existía un control vivo equivalente.
   *
   * No lanza a propósito: en PostgreSQL una violación de restricción ABORTA la
   * transacción entera, y el caso de uso no podría ni consultar cuál era el
   * control existente sin un SAVEPOINT. `ON CONFLICT DO NOTHING` sobre el
   * índice único parcial deja la transacción sana y la idempotencia sigue
   * decidiéndola el índice, no una consulta previa.
   */
  insertar(tx: Tx, estado: EstadoRecall): Promise<boolean>;
  guardar(tx: Tx, estado: EstadoRecall): Promise<void>;
  /** Controles vivos del paciente compatibles con un servicio de reserva. */
  buscarVivosCompatibles(tx: Tx, patientId: string, serviceId: string | null): Promise<EstadoRecall[]>;
  buscarVivoPorTipo(tx: Tx, patientId: string, recallTypeId: string): Promise<EstadoRecall | null>;
  buscarPorCita(tx: Tx, appointmentId: string): Promise<EstadoRecall | null>;

  // ── Intentos ──
  crearIntento(tx: Tx, input: NuevoIntento): Promise<string>;
  /**
   * Encola el envío de un intento en la outbox compartida.
   *
   * No se reutiliza `OutboxService`: aquél está construido alrededor de una
   * cita (confirmación + ventanas de recordatorio derivadas de su hora de
   * inicio), y un recall es exactamente un mensaje por intento. Lo que sí se
   * comparte —y es lo que importa— es la TABLA: consentimiento, supresión,
   * reintentos y webhooks siguen siendo los mismos.
   *
   * Devuelve `false` si la clave de idempotencia ya existía: dos workers
   * reclamando a la vez no producen dos envíos.
   */
  encolarMensajeDeIntento(tx: Tx, input: NuevoMensajeDeIntento): Promise<boolean>;
  /**
   * Cierra un intento, exigiendo que sea DE ESTE control y que siga pendiente.
   *
   * El `patientRecallId` no es decorativo: sin él, un id de intento de otro
   * control del mismo tenant pasaría RLS y cerraría la gestión equivocada. Y
   * el filtro por `status='pending'` impide reescribir el resultado de algo
   * que ya se cerró — un `UPDATE` que no encuentra fila no es un éxito
   * silencioso.
   *
   * Devuelve `false` cuando no actualizó ninguna fila; quien llama decide qué
   * error levantar.
   */
  cerrarIntento(
    tx: Tx,
    patientRecallId: string,
    attemptId: string,
    resultado: RecallAttemptResult,
    nota: string | null,
  ): Promise<boolean>;
  /**
   * Cancela el envío aún no entregado de UN intento.
   *
   * Se llama al cerrar el intento: la gestión terminó, así que lo que siga en
   * cola para ella es correo viejo. Sólo toca `pending`/`failed` — un mensaje
   * ya entregado no se puede des-enviar.
   */
  cancelarMensajesDeIntento(tx: Tx, attemptId: string): Promise<void>;
  /** Cancela intentos pendientes y sus mensajes: el ciclo terminó. */
  cancelarPendientes(tx: Tx, patientRecallId: string): Promise<void>;
  /** ¿Hay una gestión todavía sin entregar ni cerrar? */
  hayIntentoPendiente(tx: Tx, patientRecallId: string): Promise<boolean>;

  // ── Consultas ──
  listarWorklist(tx: Tx, filtros: FiltrosWorklist): Promise<PaginaWorklist>;
  metricas(tx: Tx, desde: string, hasta: string): Promise<MetricasRecall>;
  contactoDePaciente(tx: Tx, patientId: string): Promise<ContactoPaciente | null>;
  zonaHoraria(tx: Tx): Promise<string>;
  /** El tipo de control asociado a una partida de presupuesto, si tiene. */
  tipoDePartida(tx: Tx, partidaId: string): Promise<string | null>;

  // ── Worker ──
  /** Reclama controles `pending` ya vencidos, con SKIP LOCKED. */
  reclamarVencidos(tx: Tx, hoyLocal: string, limite: number): Promise<string[]>;
  /** Reclama controles con intento pendiente cuya fecha llegó. */
  reclamarIntentosVencidos(tx: Tx, ahora: Date, limite: number): Promise<string[]>;
}

/** Estados que el worklist considera "por trabajar". */
export const STATUS_ACCIONABLES: readonly RecallStatus[] = ['due', 'contacted'];

export type { RecallSource };
