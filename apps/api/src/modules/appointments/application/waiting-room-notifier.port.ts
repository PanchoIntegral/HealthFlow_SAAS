import type { AppointmentUpdatedEvent } from '@healthflow/shared-types';

/**
 * Puerto de salida para notificar cambios en tiempo real. El caso de uso
 * depende de esta abstracción; el adaptador concreto (Socket.io gateway) vive
 * en infrastructure/. Así se puede cambiar de librería de tiempo real sin
 * tocar la lógica de aplicación.
 */
export interface WaitingRoomNotifier {
  appointmentUpdated(tenantId: string, event: AppointmentUpdatedEvent): void;
}

export const WAITING_ROOM_NOTIFIER = Symbol('WAITING_ROOM_NOTIFIER');
