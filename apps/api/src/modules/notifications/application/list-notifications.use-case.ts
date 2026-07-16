import { Inject, Injectable } from '@nestjs/common';
import type { NotificationView } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from '../domain/notification.repository';
import {
  NOTIFICATIONS_NOTIFIER,
  type NotificationsNotifier,
} from './notifications-notifier.port';

/** Ventana de anticipación del recordatorio "cita próxima". */
const VENTANA_CITA_PROXIMA_MIN = 15;

/**
 * Lista las notificaciones del usuario autenticado. De paso, en la MISMA
 * transacción, sincroniza los recordatorios de "cita próxima": no hay cron
 * (decisión de diseño — ver plan), así que cualquier GET de cualquier
 * usuario del tenant dispara el scan mientras alguien tenga la app abierta.
 */
@Injectable()
export class ListNotificationsUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    @Inject(NOTIFICATION_REPOSITORY) private readonly repo: NotificationRepository,
    @Inject(NOTIFICATIONS_NOTIFIER) private readonly notifier: NotificationsNotifier,
  ) {}

  async execute(): Promise<NotificationView[]> {
    const { tenantId, userId } = this.ctx.get();

    const { nuevas, items } = await this.tenantDb.run(async (tx) => {
      const nuevas = await this.repo.syncRemindersCitaProxima(tx, VENTANA_CITA_PROXIMA_MIN);
      const items = await this.repo.listForUser(tx, userId);
      return { nuevas, items };
    });

    // Efecto externo tras confirmar la transacción: avisar en tiempo real a
    // CADA médico dueño de un recordatorio nuevo (no solo a quien hizo el GET).
    for (const { userId: destinatarioId, notification } of nuevas) {
      this.notifier.notificationCreated(tenantId, destinatarioId, { notification });
    }

    return items;
  }
}
