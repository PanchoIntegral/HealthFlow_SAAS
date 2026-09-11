import {
  esRecallVivo,
  type RecallAttemptResult,
  type RecallChannel,
  type RecallSource,
  type RecallStatus,
} from '@healthflow/shared-types';
import {
  PacienteNoContactableError,
  RecallNoVencidoError,
  TransicionRecallInvalidaError,
} from './recall.errors';
import { noEsPosterior, sumarDias, sumarMeses } from './fecha-local';

/**
 * El control pendiente de un paciente, con su máquina de estados.
 *
 * Entidad PURA: sin Nest, sin SQL, sin reloj implícito — cada método que
 * necesita el tiempo lo recibe. Eso es lo que permite probar "vencer un
 * control" sin esperar seis meses, y es lo que hace que la reconciliación de
 * eventos aplazados funcione: un recall reconciliado tres días tarde calcula
 * su vencimiento desde la fecha del EVENTO, no desde hoy.
 *
 *   pending ─→ due ─→ contacted ─→ scheduled ─→ completed
 *                │         │            │
 *                │         └→ exhausted └→ due (cita cancelada sin reemplazo)
 *                └────────────→ dismissed (desde cualquier estado vivo)
 */

export interface EstadoRecall {
  id: string;
  patientId: string;
  recallTypeId: string;
  source: RecallSource;
  sourceEntityId: string | null;
  /** Fecha local de la clínica, `YYYY-MM-DD`. */
  dueDate: string;
  status: RecallStatus;
  assignedDoctorId: string | null;
  appointmentId: string | null;
  lastContactAt: Date | null;
  nextAttemptAt: Date | null;
  completedAt: Date | null;
  dismissReason: string | null;
  /** Cuántos intentos de contacto se han hecho ya. */
  intentos: number;
}

/** Configuración del tipo de control, en lo que el dominio necesita. */
export interface ReglasRecall {
  intervalMonths: number;
  maxAttempts: number;
  attemptSpacingDays: number;
  daysBeforeFirstContact: number;
}

/** Transiciones admitidas. Todo lo que no esté aquí se rechaza. */
const TRANSICIONES: Record<RecallStatus, readonly RecallStatus[]> = {
  pending: ['due', 'scheduled', 'dismissed'],
  due: ['contacted', 'scheduled', 'dismissed', 'exhausted'],
  contacted: ['contacted', 'scheduled', 'dismissed', 'exhausted'],
  // Vuelve a 'due' cuando la cita se cancela y nadie la reemplaza.
  scheduled: ['completed', 'due', 'dismissed'],
  completed: [],
  dismissed: [],
  exhausted: [],
};

export class PatientRecall {
  private constructor(private estado: EstadoRecall) {}

  static desde(estado: EstadoRecall): PatientRecall {
    return new PatientRecall({ ...estado });
  }

  /**
   * Nace un control a partir de un hecho clínico.
   *
   * `fechaDelHecho` es la fecha LOCAL en que ocurrió —no la de hoy— para que
   * un evento reconciliado con retraso no corra el vencimiento. Si la fecha
   * calculada ya pasó, el control nace directamente en `due`: no tiene sentido
   * dejarlo `pending` esperando un barrido que lo venza en el siguiente ciclo.
   */
  static crear(input: {
    id: string;
    patientId: string;
    recallTypeId: string;
    source: RecallSource;
    sourceEntityId?: string | null;
    assignedDoctorId?: string | null;
    fechaDelHecho: string;
    hoy: string;
    reglas: Pick<ReglasRecall, 'intervalMonths'>;
  }): PatientRecall {
    const dueDate = sumarMeses(input.fechaDelHecho, input.reglas.intervalMonths);
    return new PatientRecall({
      id: input.id,
      patientId: input.patientId,
      recallTypeId: input.recallTypeId,
      source: input.source,
      sourceEntityId: input.sourceEntityId ?? null,
      dueDate,
      status: noEsPosterior(dueDate, input.hoy) ? 'due' : 'pending',
      assignedDoctorId: input.assignedDoctorId ?? null,
      appointmentId: null,
      lastContactAt: null,
      nextAttemptAt: null,
      completedAt: null,
      dismissReason: null,
      intentos: 0,
    });
  }

  get snapshot(): EstadoRecall {
    return { ...this.estado };
  }
  get status(): RecallStatus {
    return this.estado.status;
  }
  get vivo(): boolean {
    return esRecallVivo(this.estado.status);
  }

  /**
   * El barrido diario lo pasa a `due`. Idempotente por construcción: si ya no
   * está `pending`, no hace nada — así dos barridos concurrentes no se pelean.
   */
  vencer(hoy: string): void {
    if (this.estado.status !== 'pending') return;
    if (!noEsPosterior(this.fechaDePrimerContacto(0), hoy)) {
      throw new RecallNoVencidoError(this.estado.dueDate);
    }
    this.transicionar('due');
  }

  /** Igual que `vencer`, pero respetando la anticipación del tipo. */
  vencerCon(reglas: ReglasRecall, hoy: string): void {
    if (this.estado.status !== 'pending') return;
    if (!noEsPosterior(this.fechaDePrimerContacto(reglas.daysBeforeFirstContact), hoy)) {
      throw new RecallNoVencidoError(this.estado.dueDate);
    }
    this.transicionar('due');
  }

  /**
   * Registra un intento de contacto.
   *
   * Cuando se consume el último intento permitido el control pasa a
   * `exhausted`: no se abandona en `contacted` para siempre, que dejaría la
   * lista de recepción creciendo con gente a la que ya nadie va a llamar.
   */
  registrarContacto(reglas: ReglasRecall, ahora: Date): void {
    if (this.estado.status !== 'due' && this.estado.status !== 'contacted') {
      throw new TransicionRecallInvalidaError(this.estado.status, 'contacted');
    }
    const intentos = this.estado.intentos + 1;
    this.estado.intentos = intentos;
    this.estado.lastContactAt = ahora;
    if (intentos >= reglas.maxAttempts) {
      this.estado.nextAttemptAt = null;
      this.transicionar('exhausted');
      return;
    }
    this.estado.nextAttemptAt = new Date(
      ahora.getTime() + reglas.attemptSpacingDays * 86_400_000,
    );
    this.transicionar('contacted');
  }

  /** Número que le toca al siguiente intento (para la clave única). */
  siguienteIntento(): number {
    return this.estado.intentos + 1;
  }

  /**
   * Una cita compatible cierra el contacto automático. Vale desde `pending`
   * también: el paciente puede reservar antes de que nadie lo llame, que es
   * justamente el mejor caso.
   */
  vincularCita(appointmentId: string): void {
    // Una entrega repetida del MISMO evento es un no-op. Una cita distinta no
    // puede secuestrar un recall que ya estaba atribuido: eso requiere una
    // decisión explícita del caso de uso, no una auto-transición silenciosa.
    if (this.estado.status === 'scheduled' && this.estado.appointmentId === appointmentId) return;
    this.transicionar('scheduled');
    this.estado.appointmentId = appointmentId;
    this.estado.nextAttemptAt = null;
  }

  /**
   * La cita se canceló. Sólo reactiva si NO hubo reemplazo — reprogramar es
   * reemplazo, y por eso llega como `appointment.rescheduled` y ni siquiera
   * invoca este método.
   */
  reabrirPorCancelacion(hayReemplazo: boolean): void {
    if (this.estado.status !== 'scheduled') {
      throw new TransicionRecallInvalidaError(this.estado.status, 'due');
    }
    if (hayReemplazo) return;
    this.transicionar('due');
    this.estado.appointmentId = null;
  }

  /** La cita se realizó: el ciclo se cierra. El siguiente se crea aparte. */
  completar(ahora: Date): void {
    this.transicionar('completed');
    this.estado.completedAt = ahora;
    this.estado.nextAttemptAt = null;
  }

  /** Cierre manual con motivo: se mudó, ya no es paciente, pidió no insistir. */
  descartar(motivo: string, _ahora?: Date): void {
    const limpio = motivo.trim();
    if (!limpio) {
      throw new TransicionRecallInvalidaError(
        this.estado.status,
        'dismissed',
        'Para descartar un control hay que decir por qué.',
      );
    }
    this.transicionar('dismissed');
    this.estado.dismissReason = limpio.slice(0, 280);
    this.estado.nextAttemptAt = null;
  }

  /**
   * ¿Se puede contactar a este paciente?
   *
   * El consentimiento NUNCA se infiere: sin `whatsappOptIn` no hay WhatsApp,
   * aunque haya teléfono. Sin canal digital no es un error — devuelve 'phone',
   * que es una tarea para recepción, y es lo que hace que el módulo sirva en
   * una clínica sin Twilio ni dominio de correo verificado.
   */
  static elegirCanal(paciente: {
    archivado: boolean;
    email: string | null;
    emailSuprimido: boolean;
    telefono: string | null;
    whatsappOptIn: boolean;
    canalPreferido: 'whatsapp' | 'email' | 'ninguno' | null;
  }): RecallChannel {
    if (paciente.archivado) throw new PacienteNoContactableError('archivado');
    if (paciente.canalPreferido === 'ninguno') throw new PacienteNoContactableError('opt_out');

    const puedeWhatsapp = paciente.whatsappOptIn && Boolean(paciente.telefono);
    const puedeEmail = Boolean(paciente.email) && !paciente.emailSuprimido;

    if (paciente.canalPreferido === 'whatsapp' && puedeWhatsapp) return 'whatsapp';
    if (paciente.canalPreferido === 'email' && puedeEmail) return 'email';
    // Sin preferencia utilizable: correo antes que WhatsApp, porque es el
    // canal que no depende de una plantilla aprobada ni de una ventana de 24 h.
    if (puedeEmail) return 'email';
    if (puedeWhatsapp) return 'whatsapp';
    return 'phone';
  }

  /** Desde cuándo aparece en la lista de recepción. */
  private fechaDePrimerContacto(diasAntes: number): string {
    return diasAntes > 0 ? sumarDias(this.estado.dueDate, -diasAntes) : this.estado.dueDate;
  }

  private transicionar(hacia: RecallStatus): void {
    const desde = this.estado.status;
    if (!TRANSICIONES[desde].includes(hacia)) {
      throw new TransicionRecallInvalidaError(desde, hacia);
    }
    this.estado.status = hacia;
  }
}

/** Resultado de un intento que significa "ya no hay que insistir". */
export function cierraElSeguimiento(resultado: RecallAttemptResult): boolean {
  return resultado === 'booked' || resultado === 'declined';
}
