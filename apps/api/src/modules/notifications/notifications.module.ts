import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NOTIFICATION_REPOSITORY } from './domain/notification.repository';
import { NOTIFICATIONS_NOTIFIER } from './application/notifications-notifier.port';
import { ListNotificationsUseCase } from './application/list-notifications.use-case';
import { MarkNotificationReadUseCase } from './application/mark-read.use-case';
import { MarkAllNotificationsReadUseCase } from './application/mark-all-read.use-case';
import { DrizzleNotificationRepository } from './infrastructure/notification.drizzle-repo';
import { NotificationsGateway } from './infrastructure/notifications.gateway';
import { NotificationsController } from './infrastructure/notifications.controller';

/**
 * Cablea el módulo hexagonal: los casos de uso dependen de PUERTOS
 * (NOTIFICATION_REPOSITORY, NOTIFICATIONS_NOTIFIER) y aquí se enlazan a sus
 * ADAPTADORES concretos (Drizzle, Socket.io).
 *
 * Exporta ambos puertos para que appointments/billing creen notificaciones
 * (check-in, cancelación, error de timbrado) dentro de SU PROPIA transacción,
 * sin depender de Drizzle/Socket.io directamente.
 */
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [
    ListNotificationsUseCase,
    MarkNotificationReadUseCase,
    MarkAllNotificationsReadUseCase,
    NotificationsGateway,
    { provide: NOTIFICATION_REPOSITORY, useClass: DrizzleNotificationRepository },
    { provide: NOTIFICATIONS_NOTIFIER, useExisting: NotificationsGateway },
  ],
  exports: [NOTIFICATION_REPOSITORY, NOTIFICATIONS_NOTIFIER],
})
export class NotificationsModule {}
