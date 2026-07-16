import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import {
  WAITING_ROOM_EVENTS,
  type AppointmentUpdatedEvent,
} from '@healthflow/shared-types';
import type { WaitingRoomNotifier } from '../application/waiting-room-notifier.port';
import type { JwtPayload } from '../../auth/authenticated-user';
import { env } from '../../../config/env';

/** Nombre de la room de Socket.io por tenant: aísla los eventos por clínica. */
function tenantRoom(tenantId: string): string {
  return `tenant:${tenantId}`;
}

/**
 * Adaptador de tiempo real (Socket.io). Implementa el puerto WaitingRoomNotifier.
 * Cada cliente se autentica con su JWT en el handshake y se une a la room de su
 * tenant, de modo que un evento de una clínica jamás llega a otra.
 */
@WebSocketGateway({
  namespace: '/waiting-room',
  cors: { origin: env.webOrigins, credentials: true },
})
export class WaitingRoomGateway implements OnGatewayConnection, WaitingRoomNotifier {
  private readonly logger = new Logger(WaitingRoomGateway.name);

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
      client.join(tenantRoom(payload.tid));
      this.logger.debug(`cliente ${client.id} unido a ${tenantRoom(payload.tid)}`);
    } catch (err) {
      this.logger.warn(`handshake rechazado: ${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  appointmentUpdated(tenantId: string, event: AppointmentUpdatedEvent): void {
    this.server.to(tenantRoom(tenantId)).emit(WAITING_ROOM_EVENTS.APPOINTMENT_UPDATED, event);
  }
}

function extractBearer(header?: string): string | undefined {
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length);
}
