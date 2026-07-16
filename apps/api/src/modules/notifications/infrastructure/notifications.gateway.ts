import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { NOTIFICATION_EVENTS, type NotificationCreatedEvent } from '@healthflow/shared-types';
import type { NotificationsNotifier } from '../application/notifications-notifier.port';
import type { JwtPayload } from '../../auth/authenticated-user';
import { env } from '../../../config/env';

/** Room por usuario: las notificaciones son personales, no de todo el tenant. */
function userRoom(tenantId: string, userId: string): string {
  return `tenant:${tenantId}:user:${userId}`;
}

/**
 * Adaptador de tiempo real (Socket.io) para notificaciones personales. Mismo
 * handshake JWT que WaitingRoomGateway, pero la room es por USUARIO (no por
 * tenant): un recordatorio de cita es solo para el médico dueño de esa cita.
 */
@WebSocketGateway({
  namespace: '/notifications',
  cors: { origin: env.webOrigins, credentials: true },
})
export class NotificationsGateway implements OnGatewayConnection, NotificationsNotifier {
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly jwt: JwtService) {}

  handleConnection(client: Socket): void {
    try {
      const token =
        (client.handshake.auth?.token as string | undefined) ??
        extractBearer(client.handshake.headers.authorization);
      if (!token) throw new Error('sin token');

      const payload = this.jwt.verify<JwtPayload>(token, { secret: env.jwtSecret });
      client.join(userRoom(payload.tid, payload.sub));
      this.logger.debug(`cliente ${client.id} unido a ${userRoom(payload.tid, payload.sub)}`);
    } catch (err) {
      this.logger.warn(`handshake rechazado: ${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  notificationCreated(tenantId: string, userId: string, event: NotificationCreatedEvent): void {
    this.server.to(userRoom(tenantId, userId)).emit(NOTIFICATION_EVENTS.NEW, event);
  }
}

function extractBearer(header?: string): string | undefined {
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length);
}
