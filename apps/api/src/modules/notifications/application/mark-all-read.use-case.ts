import { Inject, Injectable } from '@nestjs/common';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from '../domain/notification.repository';

/** Marca TODAS las notificaciones del usuario autenticado como leídas. */
@Injectable()
export class MarkAllNotificationsReadUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    @Inject(NOTIFICATION_REPOSITORY) private readonly repo: NotificationRepository,
  ) {}

  execute(): Promise<void> {
    const { userId } = this.ctx.get();
    return this.tenantDb.run((tx) => this.repo.markAllRead(tx, userId));
  }
}
