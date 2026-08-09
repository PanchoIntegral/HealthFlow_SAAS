import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { SinClienteDeStripeError } from '../domain/subscriptions.errors';
import { StripeService } from '../infrastructure/stripe.service';
import { env } from '../../../config/env';

/**
 * Abre el portal de facturación de Stripe para la clínica autenticada: ahí
 * actualiza su tarjeta, ve sus facturas o cancela.
 *
 * Es la contraparte necesaria del gating: si se suspende a quien no paga, hay
 * que darle un camino de un clic para volver a pagar. Por eso el endpoint que
 * lo expone está exento del gating (@PermitirSinSuscripcion) — bloquearlo
 * dejaría a la cuenta suspendida sin forma de dejar de estarlo.
 */
@Injectable()
export class CreatePortalSessionUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly stripe: StripeService,
  ) {}

  async execute(): Promise<{ url: string }> {
    const customerId = await this.tenantDb.run(async (tx) => {
      const result = await tx.execute(sql`SELECT stripe_customer_id FROM tenants LIMIT 1`);
      return (result.rows as unknown as { stripe_customer_id: string | null }[])[0]
        ?.stripe_customer_id;
    });

    // Las cuentas anteriores al self-serve (y las de desarrollo) no tienen
    // cliente en Stripe: no hay portal que abrir.
    if (!customerId) throw new SinClienteDeStripeError();

    const session = await this.stripe.client.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${env.appUrl}/cuentas`,
    });

    return { url: session.url };
  }
}
