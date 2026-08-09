import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { esEspecialidadValida } from '@healthflow/shared-types';
import type Stripe from 'stripe';
import { DB } from '../../../db/drizzle.module';
import { runInTenant, type Database } from '../../../db/drizzle';
import { schema } from '../../../db/schema';
import { esSubscriptionStatus } from '../../../common/subscription/subscription-status';
import { DIAS_DE_GRACIA } from '../../../common/subscription/debe-restringir';
import { StripeService } from '../infrastructure/stripe.service';

const TICKET_TTL_MS = 30 * 60 * 1000; // 30 minutos

/**
 * Procesa los eventos de Stripe relevantes para el ciclo de vida de la
 * suscripción. `checkout.session.completed` provisiona la cuenta; los eventos
 * de subscription e invoice mantienen al día el estado de pago del que depende
 * el gating (ver common/subscription/debe-restringir.ts).
 *
 * El par importante para la suspensión/reanudación es:
 *   invoice.payment_failed → arranca el reloj de la gracia
 *   invoice.paid           → lo apaga, y con eso el acceso vuelve solo
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

    try {
      await this.despachar(event);
    } catch (err) {
      // La marca de "ya visto" se puso ANTES de procesar, para cerrar la
      // carrera entre dos entregas simultáneas. Si el trabajo falló hay que
      // soltarla: si no, el reintento de Stripe la vería y se daría por
      // procesado un evento que nunca surtió efecto — perdiéndolo para
      // siempre. Con un cobro fallido eso significa no suspender nunca.
      await this.db.execute(
        sql`DELETE FROM stripe_events WHERE id = ${event.id} AND processed_at IS NULL`,
      );
      throw err;
    }

    await this.db.execute(
      sql`UPDATE stripe_events SET processed_at = now() WHERE id = ${event.id}`,
    );
  }

  private async despachar(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        return this.provisionTenant(event.data.object as Stripe.Checkout.Session);
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        return this.syncSubscriptionStatus(event.data.object as Stripe.Subscription);
      case 'invoice.payment_failed':
        return this.registrarCobroFallido(event.data.object as Stripe.Invoice);
      // Stripe manda los dos para el mismo cobro. El handler es idempotente,
      // así que procesar ambos no hace daño y cubre configuraciones de
      // webhook que solo suscriben uno.
      case 'invoice.paid':
      case 'invoice.payment_succeeded':
        return this.registrarCobroExitoso(event.data.object as Stripe.Invoice);
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
    const tenantId = await this.resolveTenantId(
      subscription.metadata?.tenantId,
      subscription.customer,
      `subscription ${subscription.id}`,
    );

    // Si el cliente cambia de mensual a anual (o al revés) desde el portal de
    // Stripe, el intervalo del Price es la fuente de verdad — no la metadata
    // del checkout original.
    const interval = subscription.items.data[0]?.price.recurring?.interval;
    const billingPeriod = interval === 'year' ? 'anual' : interval === 'month' ? 'mensual' : null;

    // Un status que no conocemos violaría el CHECK de la tabla y tumbaría el
    // webhook entero. Se prefiere conservar el anterior y dejar rastro: el
    // resto del evento (periodo, fechas) sí vale la pena guardarlo.
    const status = esSubscriptionStatus(subscription.status) ? subscription.status : null;
    if (!status) {
      this.logger.error(
        `Stripe mandó un subscription_status desconocido: '${subscription.status}' ` +
          `(subscription ${subscription.id}). Hay que agregarlo a SUBSCRIPTION_STATUSES y al CHECK.`,
      );
    }

    await runInTenant(this.db, tenantId, (tx) =>
      tx
        .update(schema.tenants)
        .set({
          ...(status ? { subscriptionStatus: status } : {}),
          ...(billingPeriod ? { billingPeriod } : {}),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        })
        .where(eq(schema.tenants.id, tenantId)),
    );
  }

  /**
   * Arranca el reloj de la gracia tras un cobro fallido.
   *
   * Dos sutilezas, ambas deliberadas y expresadas en el propio SQL:
   *
   *  - COALESCE sobre grace_until: Stripe reintenta el cobro varias veces y
   *    manda este evento en cada intento. Sin el COALESCE, cada reintento
   *    reiniciaría la gracia y la cuenta nunca llegaría a suspenderse.
   *  - ultimo_pago_at NULL significa que nunca pagó (trial vencido sin tarjeta
   *    válida): ese no recibe gracia, se le corta ya. Si no, el trial de 14
   *    días más 7 de gracia serían 21 días gratis para quien nunca pensó pagar.
   */
  private async registrarCobroFallido(invoice: Stripe.Invoice): Promise<void> {
    const tenantId = await this.resolveTenantId(
      invoice.subscription_details?.metadata?.tenantId,
      invoice.customer,
      `invoice ${invoice.id}`,
    );

    await runInTenant(this.db, tenantId, (tx) =>
      tx.execute(sql`
        UPDATE tenants
           SET grace_until = COALESCE(
                 grace_until,
                 CASE WHEN ultimo_pago_at IS NULL
                      THEN now()
                      ELSE now() + make_interval(days => ${DIAS_DE_GRACIA})
                 END)
         WHERE id = ${tenantId}
      `),
    );

    this.logger.warn(`Cobro fallido para el tenant ${tenantId} — corre la gracia`);
  }

  /**
   * El cobro entró: se apaga el reloj de la gracia.
   *
   * Esto ES la reanudación del servicio. No hace falta "des-suspender" nada
   * porque el bloqueo nunca se almacenó: se deriva del estado actual en cada
   * escritura (ver debe-restringir.ts). En cuanto grace_until vuelve a NULL,
   * la siguiente petición del usuario ya pasa — sin reiniciar la API ni
   * volver a iniciar sesión.
   */
  private async registrarCobroExitoso(invoice: Stripe.Invoice): Promise<void> {
    const tenantId = await this.resolveTenantId(
      invoice.subscription_details?.metadata?.tenantId,
      invoice.customer,
      `invoice ${invoice.id}`,
    );

    await runInTenant(this.db, tenantId, (tx) =>
      tx.execute(sql`
        UPDATE tenants
           SET grace_until        = NULL,
               ultimo_pago_at     = now(),
               current_period_end = to_timestamp(${invoice.period_end})
         WHERE id = ${tenantId}
      `),
    );

    this.logger.log(`Cobro exitoso para el tenant ${tenantId} — servicio al corriente`);
  }

  /**
   * A qué clínica pertenece este evento.
   *
   * La metadata es el camino rápido (la pone el tag-back de provisionTenant),
   * pero no siempre está: los eventos de factura anteriores al tag-back, o si
   * el tag-back falló. El fallback busca por customer con una función
   * SECURITY DEFINER, porque `tenants` tiene FORCE ROW LEVEL SECURITY y sin
   * tenant fijado no se ve ninguna fila.
   *
   * Si no se resuelve, LANZA en vez de descartar en silencio (que es lo que
   * hacía antes): así Stripe reintenta, y el reintento encuentra el tenant que
   * el checkout apenas estaba creando. Descartarlo dejaría a una clínica
   * impaga con acceso indefinido.
   */
  private async resolveTenantId(
    metadataTenantId: string | undefined,
    customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
    ref: string,
  ): Promise<string> {
    if (metadataTenantId) return metadataTenantId;

    const customerId = typeof customer === 'string' ? customer : customer?.id;
    if (customerId) {
      const result = await this.db.execute(
        sql`SELECT stripe_tenant_by_customer(${customerId}) AS tenant_id`,
      );
      const tenantId = (result.rows as unknown as { tenant_id: string | null }[])[0]?.tenant_id;
      if (tenantId) return tenantId;
    }

    throw new Error(
      `No se pudo resolver el tenant de ${ref} (customer ${customerId ?? 'desconocido'}). ` +
        'Se deja que Stripe reintente.',
    );
  }
}

/** La metadata viene del cliente: se valida antes de tocar el CHECK de la BD. */
function normalizeBillingPeriod(value: string | undefined): 'mensual' | 'anual' {
  return value === 'anual' ? 'anual' : 'mensual';
}
