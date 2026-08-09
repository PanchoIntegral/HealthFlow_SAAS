import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, type Observable } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { EstadoSuscripcionReader } from './estado-suscripcion.reader';
import { debeRestringir } from './debe-restringir';
import { SuscripcionSuspendidaError } from './subscription.errors';
import { PERMITIR_SIN_SUSCRIPCION_KEY } from './permitir-sin-suscripcion.decorator';

/** Métodos que solo consultan. Revisados los 32 endpoints de escritura de la
 *  API: no hay ninguna búsqueda por POST, así que el método basta como
 *  criterio de "esto es lectura". */
const METODOS_DE_LECTURA = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Deja la cuenta en SOLO LECTURA cuando la suscripción está vencida: las
 * consultas pasan, las escrituras devuelven 402.
 *
 * Va como INTERCEPTOR y no como guard por dos razones:
 *
 *  1. Un APP_GUARD global corre ANTES del JwtAuthGuard de cada controlador,
 *     así que `req.user` todavía estaría vacío. Meterlo en los 15
 *     `@UseGuards(...)` sí funcionaría, pero es invasivo y se olvidaría en el
 *     próximo módulo que alguien agregue.
 *  2. Registrado DESPUÉS de RequestContextInterceptor, corre dentro de su
 *     AsyncLocalStorage (los interceptores globales se anidan en orden de
 *     registro), y por eso puede usar TenantDbService con el tenant ya fijado.
 *
 * El orden de registro en app.module.ts es parte del diseño, no un detalle.
 */
@Injectable()
export class SuscripcionInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SuscripcionInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly estado: EstadoSuscripcionReader,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest();

    // Sin usuario autenticado no hay tenant que consultar. Esto exenta de
    // paso a las rutas públicas (login, webhook de Stripe, canje del ticket
    // de onboarding) sin necesidad de un decorador @Public().
    if (!req?.user) return next.handle();

    if (METODOS_DE_LECTURA.has(req.method)) return next.handle();

    const exento = this.reflector.getAllAndOverride<boolean | undefined>(
      PERMITIR_SIN_SUSCRIPCION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (exento) return next.handle();

    return from(this.verificar()).pipe(switchMap(() => next.handle()));
  }

  private async verificar(): Promise<void> {
    const estado = await this.estado.leer();
    if (debeRestringir(estado, new Date())) {
      throw new SuscripcionSuspendidaError(estado.status, estado.graceUntil);
    }
  }
}
