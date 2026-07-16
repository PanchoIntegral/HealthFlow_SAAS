import { Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import type { NotificationView } from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ListNotificationsUseCase } from '../application/list-notifications.use-case';
import { MarkNotificationReadUseCase } from '../application/mark-read.use-case';
import { MarkAllNotificationsReadUseCase } from '../application/mark-all-read.use-case';

/**
 * Notificaciones in-app: recurso PERSONAL (cada quien lee/marca solo las
 * suyas — filtrado por user_id, más RLS de tenant). No es un "subject" CASL
 * de negocio como Factura/Finanzas, por eso alcanza con estar autenticado.
 */
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly listNotifications: ListNotificationsUseCase,
    private readonly markRead: MarkNotificationReadUseCase,
    private readonly markAllRead: MarkAllNotificationsReadUseCase,
  ) {}

  @Get()
  list(): Promise<NotificationView[]> {
    return this.listNotifications.execute();
  }

  @Post(':id/leer')
  leer(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.markRead.execute(id);
  }

  @Post('leer-todas')
  leerTodas(): Promise<void> {
    return this.markAllRead.execute();
  }
}
