import type { AppointmentStatus } from '@healthflow/shared-types';

/** Error de dominio: se intentó una transición de estado no permitida. */
export class InvalidAppointmentTransitionError extends Error {
  constructor(
    readonly from: AppointmentStatus,
    readonly to: AppointmentStatus,
  ) {
    super(`Transición de cita inválida: ${from} → ${to}`);
    this.name = 'InvalidAppointmentTransitionError';
  }
}
