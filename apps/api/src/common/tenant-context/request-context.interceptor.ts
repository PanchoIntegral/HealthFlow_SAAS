import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { RequestContextService } from './request-context';
import type { AuthenticatedUser } from '../../modules/auth/authenticated-user';

/**
 * Toma el usuario ya validado por el JwtAuthGuard (req.user) y ejecuta el
 * resto del pipeline dentro del AsyncLocalStorage, de modo que cualquier
 * caso de uso pueda leer tenantId/userId/rol de forma implícita.
 *
 * Corre DESPUÉS de los guards (orden de Nest: guards → interceptores).
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  constructor(private readonly ctx: RequestContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = req?.user;
    if (!user) {
      return next.handle();
    }
    const store = { tenantId: user.tenantId, userId: user.userId, rol: user.rol };

    /**
     * El `run` envuelve la SUSCRIPCIÓN, no la construcción del Observable.
     *
     * `return this.ctx.run(store, () => next.handle())` parece equivalente y
     * no lo es: `next.handle()` solo CONSTRUYE el observable, y todo el
     * pipeline (interceptores siguientes, handler, casos de uso) se ejecuta
     * después, al suscribirse — ya fuera del `run`, y por tanto sin contexto.
     *
     * Con la forma anterior funcionaba por accidente mientras todos los
     * interceptores de más adentro devolvían `next.handle()` de forma
     * síncrona. En cuanto uno metió un `await` antes de llamarlo
     * (SuscripcionInterceptor, que consulta el estado de pago en toda
     * ESCRITURA), la continuación pasó a otro microtask y el contexto se
     * perdió: las lecturas seguían bien y las escrituras reventaban con
     * "No hay contexto de petición".
     *
     * Envolviendo la suscripción, el contexto cubre todo lo que ocurra
     * después, sea síncrono o no.
     */
    return new Observable((subscriber) =>
      this.ctx.run(store, () => next.handle().subscribe(subscriber)),
    );
  }
}
