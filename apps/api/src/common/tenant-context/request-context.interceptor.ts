import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
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
    return this.ctx.run(
      { tenantId: user.tenantId, userId: user.userId, rol: user.rol },
      () => next.handle(),
    );
  }
}
