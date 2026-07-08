import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import type { LoginResponse, UserRole } from '@healthflow/shared-types';
import { DB } from '../../db/drizzle.module';
import type { Database } from '../../db/drizzle';
import { env } from '../../config/env';
import type { JwtPayload } from './authenticated-user';

interface UserRow {
  id: string;
  tenant_id: string;
  password_hash: string;
  nombre: string;
  rol: UserRole;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly jwt: JwtService,
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
        const payload: JwtPayload = { sub: row.id, tid: row.tenant_id, rol: row.rol };
        const accessToken = await this.jwt.signAsync(payload, {
          secret: env.jwtSecret,
          expiresIn: env.jwtExpiresIn,
        });
        return {
          accessToken,
          user: { id: row.id, tenantId: row.tenant_id, nombre: row.nombre, rol: row.rol },
        };
      }
    }

    throw new UnauthorizedException('Credenciales inválidas');
  }
}
