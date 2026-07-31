import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/** Lo mínimo que necesitamos del request — evita depender del tipo de express. */
export interface IpBearingRequest {
  ip?: string;
  ips?: string[];
  socket?: { remoteAddress?: string };
}

/**
 * IP del cliente ya normalizada. Confía en `req.ips` (que Express solo rellena
 * cuando `trust proxy` está configurado con el número exacto de saltos, ver
 * main.ts), y cae a la IP del socket si no hay nada más.
 *
 * Nunca devuelve cadena vacía: una IP indeterminada colapsa en 'unknown', que
 * se trata como un único cubo compartido — restrictivo a propósito, mejor que
 * dejar pasar peticiones sin límite.
 */
export function resolveClientIp(req: IpBearingRequest): string {
  const forwarded = req.ips?.[0];
  const ip = forwarded ?? req.ip ?? req.socket?.remoteAddress ?? '';
  if (!ip) return 'unknown';
  // IPv4 mapeada en IPv6 (::ffff:1.2.3.4) → 1.2.3.4, para que la misma IP no
  // ocupe dos cubos distintos según cómo llegue la conexión.
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export const ClientIp = createParamDecorator((_data: unknown, ctx: ExecutionContext): string =>
  resolveClientIp(ctx.switchToHttp().getRequest<IpBearingRequest>()),
);
