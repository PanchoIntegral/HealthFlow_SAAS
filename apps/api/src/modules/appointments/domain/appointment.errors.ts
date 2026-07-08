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
