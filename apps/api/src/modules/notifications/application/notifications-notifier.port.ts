import type { NotificationCreatedEvent } from '@healthflow/shared-types';

/**
 * Puerto de salida para notificar en tiempo real. El caso de uso depende de
 * esta abstracción; el adaptador concreto (Socket.io gateway) vive en
 * infrastructure/. A diferencia de WaitingRoomNotifier (por tenant), aquí el
 * destinatario es un usuario específico — las notificaciones son personales.
 */
export interface NotificationsNotifier {
  notificationCreated(tenantId: string, userId: string, event: NotificationCreatedEvent): void;
}

export const NOTIFICATIONS_NOTIFIER = Symbol('NOTIFICATIONS_NOTIFIER');
