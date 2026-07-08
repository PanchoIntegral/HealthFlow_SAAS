import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { env } from '../../config/env';
import type { AuthenticatedUser, JwtPayload } from './authenticated-user';

/**
 * Valida el JWT del header Authorization y devuelve el usuario que Nest
 * adjunta como req.user. De aquí lo toma el RequestContextInterceptor para
 * poblar el AsyncLocalStorage (tenant activo + usuario para auditoría).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: env.jwtSecret,
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    return { userId: payload.sub, tenantId: payload.tid, rol: payload.rol };
  }
}
