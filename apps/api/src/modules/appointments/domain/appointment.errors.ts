import type { AppointmentStatus } from '@healthflow/shared-types';
import { DomainError } from '../../../common/errors/domain.error';

/** Error de dominio: se intentó una transición de estado no permitida. */
export class InvalidAppointmentTransitionError extends DomainError {
  readonly code = 'InvalidAppointmentTransition';
  readonly httpStatus = 409; // Conflict

  constructor(
    readonly from: AppointmentStatus,
    readonly to: AppointmentStatus,
  ) {
    super(`Transición de cita inválida: ${from} → ${to}`);
  }

  override details(): Record<string, unknown> {
    return { from: this.from, to: this.to };
  }
}

/** El horario propuesto para la cita no es válido (fin <= inicio). */
export class InvalidAppointmentRangeError extends DomainError {
  readonly code = 'InvalidAppointmentRange';
  readonly httpStatus = 422; // Unprocessable Entity

  constructor() {
    super('El horario de la cita no es válido: el fin debe ser posterior al inicio');
  }
}

/** El médico ya tiene otra cita activa que se traslapa con el horario propuesto. */
export class DoctorDoubleBookedError extends DomainError {
  readonly code = 'DoctorDoubleBooked';
  readonly httpStatus = 409; // Conflict

  constructor() {
    super('El médico ya tiene una cita agendada en ese horario');
  }
}

/**
 * Se quiso marcar la ausencia antes de que terminara la tolerancia.
 *
 * La regla existe por un riesgo concreto: un dedazo en la sala de espera
 * marcaría como ausente a un paciente que va llegando, y esa ausencia no se
 * queda quieta — dispara `appointment.no_show`, que crea un seguimiento de
 * reactivación y le manda un mensaje a alguien que está sentado en la sala.
 * Una cadena automática nacida de un clic equivocado, y sobre un estado que
 * además es terminal: no se puede deshacer.
 *
 * `allowedAt` viaja al cliente para que el botón se muestre deshabilitado con
 * la hora a partir de la cual sí se puede, en vez de dejar al usuario probar.
 */
export class AusenciaPrematuraError extends DomainError {
  readonly code = 'AusenciaPrematura';
  readonly httpStatus = 409;

  constructor(readonly allowedAt: Date) {
    super('Todavía no puedes marcar la ausencia de esta cita.');
  }

  override details(): Record<string, unknown> {
    return { allowedAt: this.allowedAt.toISOString() };
  }
}
