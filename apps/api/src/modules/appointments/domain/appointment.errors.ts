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
