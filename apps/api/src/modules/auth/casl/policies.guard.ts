import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CaslAbilityFactory, type Action, type Subject } from './ability.factory';
import type { AuthenticatedUser } from '../authenticated-user';

export interface RequiredPolicy {
  action: Action;
  subject: Subject;
}

export const POLICIES_KEY = 'required_policies';
/** Decorador para exigir permisos CASL en un handler. */
export const RequirePolicy = (action: Action, subject: Subject) =>
  SetMetadata(POLICIES_KEY, { action, subject } satisfies RequiredPolicy);

/**
 * Verifica que el usuario tenga el permiso CASL requerido por el handler.
 * Corre tras el JwtAuthGuard (que ya pobló req.user).
 */
@Injectable()
export class PoliciesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly abilityFactory: CaslAbilityFactory,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const policy = this.reflector.getAllAndOverride<RequiredPolicy | undefined>(
      POLICIES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!policy) return true;

    const user: AuthenticatedUser | undefined = context.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('No autenticado');

    const ability = this.abilityFactory.createForUser(user);
    if (!ability.can(policy.action, policy.subject)) {
      throw new ForbiddenException(
        `Tu rol (${user.rol}) no puede ${policy.action} sobre ${policy.subject}`,
      );
    }
    return true;
  }
}
