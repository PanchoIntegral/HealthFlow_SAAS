import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, type Observable } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import type { FeatureFlag } from '@healthflow/shared-types';
import { CapacidadService } from './capacidad.service';
import { ModuloNoDisponibleError } from './capacidad.errors';
import { REQUIERE_MODULO_KEY } from './requiere-modulo.decorator';
import { permite, razonDe, type ModoAcceso } from './capacidad';

/** Mismos métodos que trata como lectura SuscripcionInterceptor. */
const METODOS_DE_LECTURA = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Hace valer @RequiereModulo en el borde: si la clínica no puede usar el
 * módulo, la ruta responde 404 y el caso de uso ni siquiera corre.
 *
 * Interceptor y no guard por la MISMA razón que SuscripcionInterceptor: un
 * guard global corre antes de que JwtAuthGuard pueble `req.user` y antes de
 * que RequestContextInterceptor abra el AsyncLocalStorage con el tenant — sin
 * tenant fijado no hay a quién consultarle la capacidad. Registrado después de
 * aquel en app.module.ts, este corre dentro de su contexto.
 *
 * La suscripción vencida es el único caso que aquí NO bloquea una lectura: de
 * eso se encarga SuscripcionInterceptor, que corta escrituras con 402 y deja
 * consultar. Cortarle a un médico el historial de recalls de sus pacientes por
 * un tema de cobranza sería el mismo error que ya se decidió no cometer con el
 * expediente.
 *
 * Esto NO sustituye la verificación en el dominio: un caso de uso invocado
 * desde el worker o desde un consumidor de eventos no pasa por aquí, y por eso
 * existe `CapacidadService.asegurar(tx, modulo)`.
 */
@Injectable()
export class CapacidadInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly capacidad: CapacidadService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const modulo = this.reflector.getAllAndOverride<FeatureFlag | undefined>(REQUIERE_MODULO_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!modulo) return next.handle();

    // Las rutas públicas (portal del paciente, aceptación de un plan) no
    // tienen usuario ni tenant en contexto: resuelven el tenant desde su token
    // y comprueban la capacidad dentro de su propia transacción.
    if (!context.switchToHttp().getRequest()?.user) return next.handle();

    const modo: ModoAcceso = METODOS_DE_LECTURA.has(context.switchToHttp().getRequest()?.method)
      ? 'lectura'
      : 'escritura';
    return from(this.verificar(modulo, modo)).pipe(switchMap(() => next.handle()));
  }

  private async verificar(modulo: FeatureFlag, modo: ModoAcceso): Promise<void> {
    const capacidad = await this.capacidad.evaluarSuelto(modulo);
    if (!permite(capacidad, modo)) {
      throw new ModuloNoDisponibleError(modulo, razonDe(capacidad)!);
    }
  }
}
