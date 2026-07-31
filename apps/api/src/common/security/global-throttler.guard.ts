import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { resolveClientIp, type IpBearingRequest } from './client-ip';

/** Rutas exentas del límite global (ver `shouldSkip`). */
const SKIPPED_PATHS = ['/api/subscriptions/webhook'];

/**
 * Guard de rate limiting aplicado a TODA la API (se monta como APP_GUARD).
 *
 * Dos diferencias con el ThrottlerGuard de fábrica:
 *  - la clave de conteo es la IP real del cliente resuelta con las mismas
 *    reglas que el resto del sistema (ver client-ip.ts);
 *  - el webhook de Stripe queda exento: sus entregas ya vienen autenticadas
 *    por firma HMAC y llegan a ráfagas desde las IPs de Stripe, así que
 *    limitarlo solo conseguiría perder eventos de facturación.
 */
@Injectable()
export class GlobalThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: IpBearingRequest): Promise<string> {
    return resolveClientIp(req);
  }

  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true; // websockets: se filtran en el gateway
    const req = context.switchToHttp().getRequest<{ originalUrl?: string; url?: string }>();
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';
    return SKIPPED_PATHS.includes(path);
  }
}
