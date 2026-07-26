import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { UserRole } from '@healthflow/shared-types';
import { DB } from '../../../db/drizzle.module';
import type { Database } from '../../../db/drizzle';

interface RedeemRow {
  status: 'pending' | 'expired' | 'ok';
  user_id: string | null;
  tenant_id: string | null;
  nombre: string | null;
  rol: UserRole | null;
}

export type RedeemResult =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'ok'; userId: string; tenantId: string; nombre: string; rol: UserRole };

/**
 * Envuelve `redeem_onboarding_ticket()` (función SECURITY DEFINER, ver
 * 0009_subscriptions.sql). Es la única operación que AuthModule necesita de
 * este módulo — por eso se expone como servicio propio en vez de acoplar
 * AuthModule al resto de subscriptions (Stripe, checkout, etc).
 */
@Injectable()
export class OnboardingTicketsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async redeem(stripeSessionId: string): Promise<RedeemResult> {
    const result = await this.db.execute(
      sql`SELECT * FROM redeem_onboarding_ticket(${stripeSessionId})`,
    );
    const row = result.rows[0] as unknown as RedeemRow;

    if (row.status !== 'ok') {
      return { status: row.status };
    }
    return {
      status: 'ok',
      userId: row.user_id!,
      tenantId: row.tenant_id!,
      nombre: row.nombre!,
      rol: row.rol!,
    };
  }
}
