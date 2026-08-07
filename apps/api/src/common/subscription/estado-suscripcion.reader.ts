import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { TenantDbService } from '../tenant-context/tenant-db.service';
import { esSubscriptionStatus, type EstadoSuscripcion } from './subscription-status';

/**
 * Estado de pago del tenant activo. Mismo patrón que PlanService
 * (common/plan/plan.service.ts): `SELECT ... FROM tenants LIMIT 1` sin WHERE,
 * porque RLS ya deja ver únicamente la fila de la clínica en curso.
 *
 * Sin caché a propósito: cachear el estado retrasaría la reanudación tras el
 * pago (que es justo el momento en que el usuario está mirando la pantalla) y
 * además no sería válida con varias instancias de la API. Es una query por
 * ESCRITURA, que son la minoría de las peticiones.
 */
@Injectable()
export class EstadoSuscripcionReader {
  constructor(private readonly tenantDb: TenantDbService) {}

  async leer(): Promise<EstadoSuscripcion> {
    const row = await this.tenantDb.run(async (tx) => {
      const result = await tx.execute(
        sql`SELECT subscription_status, grace_until FROM tenants LIMIT 1`,
      );
      return (result.rows as unknown as
        | { subscription_status: string; grace_until: Date | string | null }[])[0];
    });

    // Sin fila (no debería pasar: el JWT trae un tenant que existe) se trata
    // como 'none' — no bloquear por una lectura rara es preferible a dejar
    // fuera a una clínica que sí paga.
    const status = row?.subscription_status ?? 'none';

    return {
      status: esSubscriptionStatus(status) ? status : 'none',
      graceUntil: row?.grace_until ? new Date(row.grace_until) : null,
    };
  }
}
