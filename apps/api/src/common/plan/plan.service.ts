import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { limitesDePlan, type LimitesPlan } from '@healthflow/shared-types';
import type { Tx } from '../../db/drizzle';

/**
 * Qué incluye el plan del tenant activo. Un solo lugar que traduce la columna
 * `tenants.plan` a los cupos que vende la página de precios (LIMITES_PLAN en
 * shared-types), para que ningún caso de uso invente sus propios números.
 *
 * Recibe la transacción del caso de uso: el SELECT va con el tenant fijado, así
 * que RLS solo deja ver la fila de la clínica en curso — no hace falta pasarle
 * el tenantId ni confiar en que quien llama lo pase bien.
 */
@Injectable()
export class PlanService {
  /** Clave cruda del plan contratado ('individual', 'consultorio', …). */
  async planKey(tx: Tx): Promise<string> {
    const result = await tx.execute(sql`SELECT plan FROM tenants LIMIT 1`);
    const row = (result.rows as unknown as { plan: string }[])[0];
    return row?.plan ?? 'individual';
  }

  async limites(tx: Tx): Promise<LimitesPlan> {
    return limitesDePlan(await this.planKey(tx));
  }

  /** Plan + límites en una sola lectura (la pantalla de cuentas necesita ambos). */
  async planYLimites(tx: Tx): Promise<{ plan: string; limites: LimitesPlan }> {
    const plan = await this.planKey(tx);
    return { plan, limites: limitesDePlan(plan) };
  }
}
