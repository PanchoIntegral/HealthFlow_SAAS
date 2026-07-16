import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from '../domain/notification.repository';

/** Marca UNA notificación como leída. Solo su dueño puede marcarla (filtrado por user_id). */
@Injectable()
export class MarkNotificationReadUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    @Inject(NOTIFICATION_REPOSITORY) private readonly repo: NotificationRepository,
  ) {}

  async execute(id: string): Promise<void> {
    const { userId } = this.ctx.get();
    const afectada = await this.tenantDb.run((tx) => this.repo.markRead(tx, id, userId));
    if (!afectada) throw new NotFoundException('Notificación no encontrada');
  }
}
