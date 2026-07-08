import type { AppointmentStatus } from '@healthflow/shared-types';
import { InvalidAppointmentTransitionError } from './appointment.errors';

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
  get estatus(): AppointmentStatus {
    return this.props.estatus;
  }
  get checkinAt(): Date | null {
    return this.props.checkinAt;
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

  markNoShow(): void {
    this.transition('no_asistio');
  }

  toState(): AppointmentProps {
    return { ...this.props };
  }
}
