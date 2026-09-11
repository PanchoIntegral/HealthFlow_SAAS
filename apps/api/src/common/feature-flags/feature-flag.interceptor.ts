import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, type Observable } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import type { FeatureFlag } from '@healthflow/shared-types';
import { FeatureFlagsService } from './feature-flags.service';
import { ModuloNoDisponibleError } from './feature-flags.errors';
import { REQUIERE_FLAG_KEY } from './requiere-flag.decorator';

/**
 * Hace valer @RequiereFlag en el borde: si la clínica no tiene el módulo
 * liberado, la ruta responde 404 y el caso de uso ni siquiera corre.
 *
 * Interceptor y no guard por la MISMA razón que SuscripcionInterceptor: un
 * guard global corre antes de que JwtAuthGuard pueble `req.user` y antes de
 * que RequestContextInterceptor abra el AsyncLocalStorage con el tenant — sin
 * tenant fijado no hay a quién consultarle el flag. Registrado después de
 * aquel en app.module.ts, este corre dentro de su contexto.
 *
 * Esto NO sustituye la verificación en el dominio: un caso de uso invocado
 * desde el worker o desde otro módulo no pasa por aquí, y por eso los casos de
 * uso sensibles llaman además a `asegurarHabilitado(tx, flag)`.
 */
@Injectable()
export class FeatureFlagInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly flags: FeatureFlagsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const flag = this.reflector.getAllAndOverride<FeatureFlag | undefined>(REQUIERE_FLAG_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!flag) return next.handle();

    // Las rutas públicas (portal del paciente, aceptación de un plan) no
    // tienen usuario ni tenant en contexto: resuelven el tenant desde su token
    // y comprueban el flag dentro de su propia transacción.
    if (!context.switchToHttp().getRequest()?.user) return next.handle();

    return from(this.verificar(flag)).pipe(switchMap(() => next.handle()));
  }

  private async verificar(flag: FeatureFlag): Promise<void> {
    if (!(await this.flags.leer(flag))) throw new ModuloNoDisponibleError(flag);
  }
}
