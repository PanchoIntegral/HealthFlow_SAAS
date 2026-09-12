import type { AppointmentStatus } from '@healthflow/shared-types';
import {
  AusenciaPrematuraError,
  InvalidAppointmentRangeError,
  InvalidAppointmentTransitionError,
} from './appointment.errors';

/**
 * Cuánto se espera tras la hora de fin antes de poder marcar una ausencia.
 *
 * Treinta minutos es una suposición razonable, no un dato: hay que validarla
 * con recepción. Vive aquí como constante para que cambiarla sea un cambio y
 * no una búsqueda, y el caso de uso puede pasar otro umbral.
 */
export const TOLERANCIA_AUSENCIA_MINUTOS = 30;

/**
 * Mapa explícito de transiciones permitidas. Los estados terminales
 * (finalizada, cancelada, no_asistio) tienen lista vacía: NINGUNA salida.
 * Esta es la única fuente de verdad del ciclo de vida de una cita.
 */
export const ALLOWED_TRANSITIONS: Readonly<
  Record<AppointmentStatus, readonly AppointmentStatus[]>
> = {
  // 'no_asistio' desde 'agendada' además de desde 'en_espera': el caso
  // típico es justamente el paciente que nunca llegó a registrarse.
  agendada: ['en_espera', 'cancelada', 'no_asistio'],
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
  /** Hora de fin prevista. Es la base de la tolerancia de ausencia. */
  finProgramado: Date;
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
  get doctorId(): string {
    return this.props.doctorId;
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

  /** Valida que el horario propuesto sea coherente (fin posterior a inicio). */
  static assertValidRange(inicioProgramado: Date, finProgramado: Date): void {
    if (finProgramado.getTime() <= inicioProgramado.getTime()) {
      throw new InvalidAppointmentRangeError();
    }
  }

  /**
   * Marca la ausencia, pero sólo cuando ya pasó la tolerancia.
   *
   * El reloj se INYECTA y no se consulta dentro: es lo que permite probar la
   * regla sin esperar media hora, y lo que evita que dos capas discrepen
   * sobre qué hora es.
   */
  markNoShow(now: Date, toleranciaMinutos: number = TOLERANCIA_AUSENCIA_MINUTOS): void {
    const permitidoDesde = new Date(
      this.props.finProgramado.getTime() + toleranciaMinutos * 60_000,
    );
    // La tolerancia se comprueba ANTES que la transición: a un paciente que
    // sigue en consulta hay que decirle que el estado no corresponde, pero a
    // uno cuya cita acaba de empezar, que todavía no es hora.
    if (this.canTransitionTo('no_asistio') && now.getTime() < permitidoDesde.getTime()) {
      throw new AusenciaPrematuraError(permitidoDesde);
    }
    this.transition('no_asistio');
  }

  /** Desde cuándo se puede marcar la ausencia. Para la UI. */
  ausenciaPermitidaDesde(toleranciaMinutos: number = TOLERANCIA_AUSENCIA_MINUTOS): Date {
    return new Date(this.props.finProgramado.getTime() + toleranciaMinutos * 60_000);
  }

  toState(): AppointmentProps {
    return { ...this.props };
  }
}
