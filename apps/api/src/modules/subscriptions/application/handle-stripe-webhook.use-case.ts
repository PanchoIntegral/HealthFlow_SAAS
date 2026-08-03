import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { esEspecialidadValida } from '@healthflow/shared-types';
import type Stripe from 'stripe';
import { DB } from '../../../db/drizzle.module';
import { runInTenant, type Database } from '../../../db/drizzle';
import { schema } from '../../../db/schema';
import { StripeService } from '../infrastructure/stripe.service';

const TICKET_TTL_MS = 30 * 60 * 1000; // 30 minutos

/**
 * Procesa los eventos de Stripe relevantes para el ciclo de vida de la
 * suscripción. `checkout.session.completed` es lo que provisiona la cuenta:
 * el resto solo sincroniza `subscription_status` (aún sin gating en el resto
 * del sistema — ver plan de suscripciones).
 */
@Injectable()
export class HandleStripeWebhookUseCase {
  private readonly logger = new Logger(HandleStripeWebhookUseCase.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly stripe: StripeService,
  ) {}

  async execute(event: Stripe.Event): Promise<void> {
    // Idempotencia: Stripe reintenta entregas. Si ya se procesó este evento,
    // no se repiten los efectos secundarios (crear tenant, etc).
    const inserted = await this.db.execute(
      sql`INSERT INTO stripe_events (id, type) VALUES (${event.id}, ${event.type}) ON CONFLICT (id) DO NOTHING`,
    );
    if (inserted.rowCount === 0) {
      this.logger.log(`Evento ${event.id} (${event.type}) ya procesado — se ignora`);
      return;
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await this.provisionTenant(event.data.object as Stripe.Checkout.Session);
        return;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.syncSubscriptionStatus(event.data.object as Stripe.Subscription);
        return;
      default:
        return;
    }
  }

  private async provisionTenant(session: Stripe.Checkout.Session): Promise<void> {
    if (session.mode !== 'subscription') return;

    const meta = session.metadata ?? {};
    const { nombreClinica, ownerNombre, ownerEmail, passwordHash, plan } = meta;
    if (!nombreClinica || !ownerNombre || !ownerEmail || !passwordHash || !plan) {
      this.logger.error(`checkout.session ${session.id} sin metadata completa — no se provisiona`);
      return;
    }

    // Sin esto el tenant anual quedaba indistinguible de uno mensual: el
    // Price correcto sí se cobraba, pero el periodo se perdía en el webhook.
    const billingPeriod = normalizeBillingPeriod(meta.periodo);

    const tenantId = randomUUID();
    const userId = randomUUID();
    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
    const subscriptionId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;

    // Genera los UUID en Node y los inserta con el tenant ya "activo" vía
    // set_config: así el WITH CHECK de la política RLS de `tenants` pasa
    // (la fila nueva ya coincide con el tenant fijado para la transacción).
    await runInTenant(this.db, tenantId, async (tx) => {
      await tx.insert(schema.tenants).values({
        id: tenantId,
        nombreClinica,
        plan,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        subscriptionStatus: 'trialing',
        billingPeriod,
      });

      await tx.insert(schema.users).values({
        id: userId,
        tenantId,
        email: ownerEmail,
        passwordHash,
        nombre: ownerNombre,
        // 'admin' por los permisos (manage all) + esMedico para que aparezca
        // en la lista de médicos al agendar: quien compra la cuenta es el
        // médico que atiende, y hoy es el único usuario del tenant.
        rol: 'admin',
        esMedico: true,
        // Personaliza su nota clínica desde la primera consulta. Las sesiones
        // creadas antes de existir esta función no traen el dato ⇒ 'general'.
        especialidadKey: esEspecialidadValida(meta.especialidad) ? meta.especialidad : 'general',
      });

      await tx.insert(schema.onboardingTickets).values({
        tenantId,
        userId,
        stripeCheckoutSessionId: session.id,
        expiresAt: new Date(Date.now() + TICKET_TTL_MS),
      });
    });

    // Tag-back: así los eventos futuros de esta suscripción traen el tenantId
    // directo en su propia metadata, sin necesitar un lookup cross-tenant. Se
    // aísla en su propio try/catch: el tenant+usuario YA quedaron committeados
    // arriba, así que una falla aquí no debe tumbar el webhook completo (eso
    // solo lograría que Stripe reintente algo que la idempotencia de arriba ya
    // va a ignorar, dejando el tag-back sin una segunda oportunidad real).
    if (subscriptionId) {
      try {
        await this.stripe.client.subscriptions.update(subscriptionId, {
          metadata: { tenantId },
        });
      } catch (err) {
        this.logger.error(
          `No se pudo etiquetar la subscription ${subscriptionId} con tenantId ${tenantId}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }

  private async syncSubscriptionStatus(subscription: Stripe.Subscription): Promise<void> {
    const tenantId = subscription.metadata?.tenantId;
    if (!tenantId) {
      // Puede llegar antes de que el tag-back de provisionTenant termine.
      // Un evento posterior lo traerá — no hay gating que dependa de esto hoy.
      this.logger.warn(`subscription ${subscription.id} sin tenantId en metadata — se ignora`);
      return;
    }

    // Si el cliente cambia de mensual a anual (o al revés) desde el portal de
    // Stripe, el intervalo del Price es la fuente de verdad — no la metadata
    // del checkout original.
    const interval = subscription.items.data[0]?.price.recurring?.interval;
    const billingPeriod = interval === 'year' ? 'anual' : interval === 'month' ? 'mensual' : null;

    await runInTenant(this.db, tenantId, (tx) =>
      tx
        .update(schema.tenants)
        .set({
          subscriptionStatus: subscription.status,
          ...(billingPeriod ? { billingPeriod } : {}),
        })
        .where(eq(schema.tenants.id, tenantId)),
    );
  }
}

/** La metadata viene del cliente: se valida antes de tocar el CHECK de la BD. */
function normalizeBillingPeriod(value: string | undefined): 'mensual' | 'anual' {
  return value === 'anual' ? 'anual' : 'mensual';
}
