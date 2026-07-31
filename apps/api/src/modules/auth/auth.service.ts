import { HttpException, HttpStatus, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { sql } from 'drizzle-orm';
import type { LoginResponse, UserRole } from '@healthflow/shared-types';
import { DB } from '../../db/drizzle.module';
import type { Database } from '../../db/drizzle';
import { env } from '../../config/env';
import type { JwtPayload } from './authenticated-user';
import { LoginAttemptsService } from './application/login-attempts.service';
import { PasswordHasherService } from './application/password-hasher.service';
import {
  OnboardingTicketsService,
  type RedeemResult,
} from '../subscriptions/application/onboarding-tickets.service';

/**
 * 429 con cabecera Retry-After: le dice al cliente legítimo cuándo volver, en
 * vez de dejarlo reintentando a ciegas (y sumando fallos).
 */
function tooManyAttempts(retryAfterSeconds: number): HttpException {
  return new HttpException(
    {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      message: `Demasiados intentos fallidos. Reintenta en ${retryAfterSeconds} segundos.`,
      retryAfter: retryAfterSeconds,
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

interface UserRow {
  id: string;
  tenant_id: string;
  password_hash: string;
  nombre: string;
  rol: UserRole;
}

export type ExchangeTicketResult = LoginResponse | { status: 'pending' } | { status: 'expired' };

/**
 * Tope de comparaciones bcrypt por intento de login. El mismo email puede
 * existir en varios tenants, y sin tope una sola petición podría disparar
 * decenas de hashes: un multiplicador de coste regalado al atacante.
 */
const MAX_HASH_COMPARISONS = 3;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly onboardingTickets: OnboardingTicketsService,
    private readonly attempts: LoginAttemptsService,
    private readonly hasher: PasswordHasherService,
  ) {}

  /**
   * Autentica con contraseña. El orden de las comprobaciones es intencionado:
   * lo barato primero (¿está bloqueado?) y el trabajo caro (bcrypt) al final,
   * para que un ataque de fuerza bruta se detenga antes de costarnos CPU.
   *
   * @param ip IP real del cliente, ya resuelta (ver common/security/client-ip.ts).
   */
  async login(email: string, password: string, ip: string): Promise<LoginResponse> {
    const blockedFor = await this.attempts.retryAfter(email, ip);
    if (blockedFor > 0) throw tooManyAttempts(blockedFor);

    // Lectura cross-tenant vía función SECURITY DEFINER (ver 0002_auth_login.sql).
    const result = await this.db.execute(
      sql`SELECT id, tenant_id, password_hash, nombre, rol FROM auth_find_user_by_email(${email})`,
    );
    const rows = (result.rows as unknown as UserRow[]).slice(0, MAX_HASH_COMPARISONS);

    // Puede haber el mismo email en distintos tenants: elige aquel cuyo hash cuadre.
    for (const row of rows) {
      if (await this.hasher.compare(password, row.password_hash)) {
        await this.attempts.clear(email, ip);
        return this.mintSession({
          userId: row.id,
          tenantId: row.tenant_id,
          nombre: row.nombre,
          rol: row.rol,
        });
      }
    }

    // El email no existe: se gasta igualmente un bcrypt contra un hash de
    // descarte. Responder "no existe" en 2 ms y "contraseña incorrecta" en
    // 100 ms sería un oráculo para enumerar las cuentas dadas de alta.
    if (rows.length === 0) await this.hasher.compareAgainstDummy(password);

    const retryAfter = await this.attempts.registerFailure(email, ip);
    // Se registra el fallo con la IP para poder rastrear un ataque en los logs;
    // nunca la contraseña probada.
    this.logger.warn(`Login fallido para ${email} desde ${ip}`);

    if (retryAfter > 0) throw tooManyAttempts(retryAfter);
    // Mensaje deliberadamente genérico: no distingue email inexistente de
    // contraseña incorrecta.
    throw new UnauthorizedException('Credenciales inválidas');
  }

  /** Canjea el ticket de un solo uso emitido tras un pago exitoso (ver 0009_subscriptions.sql). */
  async exchangeTicket(stripeSessionId: string): Promise<ExchangeTicketResult> {
    const result: RedeemResult = await this.onboardingTickets.redeem(stripeSessionId);
    if (result.status !== 'ok') {
      return { status: result.status };
    }
    return this.mintSession({
      userId: result.userId,
      tenantId: result.tenantId,
      nombre: result.nombre,
      rol: result.rol,
    });
  }

  private async mintSession(params: {
    userId: string;
    tenantId: string;
    nombre: string;
    rol: UserRole;
  }): Promise<LoginResponse> {
    const payload: JwtPayload = { sub: params.userId, tid: params.tenantId, rol: params.rol };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: env.jwtSecret,
      expiresIn: env.jwtExpiresIn,
    });
    return {
      accessToken,
      user: {
        id: params.userId,
        tenantId: params.tenantId,
        nombre: params.nombre,
        rol: params.rol,
      },
    };
  }
}
