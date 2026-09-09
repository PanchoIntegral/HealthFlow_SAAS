import { Inject, Injectable } from '@nestjs/common';
import type { NotificationView } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from '../domain/notification.repository';

/**
 * Lista notificaciones internas. Los recordatorios al paciente viven en la
 * outbox transaccional y nunca dependen de que alguien abra esta pantalla.
 */
@Injectable()
export class ListNotificationsUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    @Inject(NOTIFICATION_REPOSITORY) private readonly repo: NotificationRepository,
  ) {}

  async execute(): Promise<NotificationView[]> {
    const { userId } = this.ctx.get();
    return this.tenantDb.run((tx) => this.repo.listForUser(tx, userId));
  }
}
