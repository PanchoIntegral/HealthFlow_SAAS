import type { AppointmentStatus } from '@healthflow/shared-types';
import { InvalidAppointmentRangeError, InvalidAppointmentTransitionError } from './appointment.errors';
import { CitaNoConfirmableError } from '../../whatsapp/domain/whatsapp.errors';

/**
 * Mapa explícito de transiciones permitidas. Los estados terminales
 * (finalizada, cancelada, no_asistio) tienen lista vacía: NINGUNA salida.
 * Esta es la única fuente de verdad del ciclo de vida de una cita.
 */
export const ALLOWED_TRANSITIONS: Readonly<
  Record<AppointmentStatus, readonly AppointmentStatus[]>
> = {
  agendada: ['en_espera', 'cancelada'],
  en_espera: ['en_consulta', 'no_asistio'],
  en_consulta: ['finalizada'],
  finalizada: [],
  cancelada: [],
  no_asistio: [],
};

export interface AppointmentProps {
  id: string;
  tenantId: string;
  patientId: string;
  doctorId: string;
  estatus: AppointmentStatus;
  checkinAt: Date | null;
  inicioReal: Date | null;
  finReal: Date | null;
  /**
   * Cuándo confirmó el paciente su asistencia (hoy, por WhatsApp).
   *
   * Es un dato ORTOGONAL al `estatus`, no un estado más: una cita confirmada
   * sigue siendo 'agendada' y recorre el mismo ciclo de vida. Modelarlo como
   * estado habría obligado a tocar ALLOWED_TRANSITIONS, el calendario y la
   * sala de espera para expresar algo que no cambia lo que se puede hacer con
   * la cita.
   */
  confirmadaAt: Date | null;
}

/**
 * Entidad de dominio. Contiene SOLO reglas de negocio puras; sin efectos
 * secundarios (WebSocket, persistencia, auditoría) — esos viven en la capa
 * de aplicación (casos de uso).
 */
export class Appointment {
  private constructor(private props: AppointmentProps) {}

  static fromState(props: AppointmentProps): Appointment {
    return new Appointment({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get tenantId(): string {
    return this.props.tenantId;
  }
  get patientId(): string {
    return this.props.patientId;
  }
  get doctorId(): string {
    return this.props.doctorId;
  }
  get estatus(): AppointmentStatus {
    return this.props.estatus;
  }
  get checkinAt(): Date | null {
    return this.props.checkinAt;
  }
  get confirmadaAt(): Date | null {
    return this.props.confirmadaAt;
  }

  /**
   * El paciente confirma que va a venir. No pasa por `transition()`: no hay
   * cambio de estado y `agendada → agendada` no es una transición válida.
   *
   * Idempotente porque el mismo webhook de Meta puede llegar dos veces (Meta
   * reintenta si tarda la respuesta) y porque nada impide al paciente pulsar
   * el botón dos veces. Se conserva la PRIMERA confirmación, que es el dato
   * que la clínica querría auditar.
   */
  confirmar(now: Date = new Date()): void {
    if (this.props.estatus !== 'agendada') {
      throw new CitaNoConfirmableError(this.props.estatus);
    }
    if (this.props.confirmadaAt) return;
    this.props.confirmadaAt = now;
  }

  canTransitionTo(to: AppointmentStatus): boolean {
    return ALLOWED_TRANSITIONS[this.props.estatus].includes(to);
  }

  private transition(to: AppointmentStatus): void {
    if (!this.canTransitionTo(to)) {
      throw new InvalidAppointmentTransitionError(this.props.estatus, to);
    }
    this.props.estatus = to;
  }

  /** Check-in del paciente: agendada → en_espera. Registra la hora de llegada. */
  checkIn(now: Date = new Date()): void {
    this.transition('en_espera');
    this.props.checkinAt = now;
  }

  /** Inicio de consulta: en_espera → en_consulta. */
  startConsultation(now: Date = new Date()): void {
    this.transition('en_consulta');
    this.props.inicioReal = now;
  }

  /** Cierre: en_consulta → finalizada. */
  finish(now: Date = new Date()): void {
    this.transition('finalizada');
    this.props.finReal = now;
  }

  cancel(): void {
    this.transition('cancelada');
  }

  /** Valida que el horario propuesto sea coherente (fin posterior a inicio). */
  static assertValidRange(inicioProgramado: Date, finProgramado: Date): void {
    if (finProgramado.getTime() <= inicioProgramado.getTime()) {
      throw new InvalidAppointmentRangeError();
    }
  }

  markNoShow(): void {
    this.transition('no_asistio');
  }

  toState(): AppointmentProps {
    return { ...this.props };
  }
}
