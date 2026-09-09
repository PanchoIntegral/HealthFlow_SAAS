import type { NotificationType, NotificationView } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';

export interface CreateNotificationInput {
  userId: string;
  appointmentId: string | null;
  tipo: NotificationType;
  titulo: string;
  mensaje: string;
}

/**
 * Puerto (interface) del repositorio de notificaciones. El dominio/aplicación
 * dependen de esta abstracción, NO de Drizzle. El adaptador concreto vive en
 * infrastructure/. Todos los métodos reciben la transacción con tenant fijado.
 */
export interface NotificationRepository {
  listForUser(tx: Tx, userId: string, limit?: number): Promise<NotificationView[]>;

  /** Usado por otros módulos (check-in, cancelación, timbrado) dentro de SU PROPIA transacción. */
  create(tx: Tx, input: CreateNotificationInput): Promise<NotificationView>;

  /** true si marcó una fila (existía y era del usuario); false → 404 en el use case. */
  markRead(tx: Tx, id: string, userId: string): Promise<boolean>;

  markAllRead(tx: Tx, userId: string): Promise<void>;

}

export const NOTIFICATION_REPOSITORY = Symbol('NOTIFICATION_REPOSITORY');
