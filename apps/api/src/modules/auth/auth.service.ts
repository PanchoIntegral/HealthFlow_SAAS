import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import type { LoginResponse, UserRole } from '@healthflow/shared-types';
import { DB } from '../../db/drizzle.module';
import type { Database } from '../../db/drizzle';
import { env } from '../../config/env';
import type { JwtPayload } from './authenticated-user';
import {
  OnboardingTicketsService,
  type RedeemResult,
} from '../subscriptions/application/onboarding-tickets.service';

interface UserRow {
  id: string;
  tenant_id: string;
  password_hash: string;
  nombre: string;
  rol: UserRole;
}

export type ExchangeTicketResult = LoginResponse | { status: 'pending' } | { status: 'expired' };

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly onboardingTickets: OnboardingTicketsService,
  ) {}

  async login(email: string, password: string): Promise<LoginResponse> {
    // Lectura cross-tenant vía función SECURITY DEFINER (ver 0002_auth_login.sql).
    const result = await this.db.execute(
      sql`SELECT id, tenant_id, password_hash, nombre, rol FROM auth_find_user_by_email(${email})`,
    );
    const rows = result.rows as unknown as UserRow[];

    // Puede haber el mismo email en distintos tenants: elige aquel cuyo hash cuadre.
    for (const row of rows) {
      if (await bcrypt.compare(password, row.password_hash)) {
        return this.mintSession({
          userId: row.id,
          tenantId: row.tenant_id,
          nombre: row.nombre,
          rol: row.rol,
        });
      }
    }

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
