import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import type {
  FacturacionView,
  MetodoPagoView,
  PagoPendienteView,
  PagoView,
} from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { StripeService } from '../infrastructure/stripe.service';

/** Cuántos cobros se muestran. Un año de mensualidades cabe de sobra. */
const MAX_PAGOS = 12;

interface TenantRow {
  plan: string;
  subscription_status: string;
  billing_period: string;
  current_period_end: Date | string | null;
  stripe_customer_id: string | null;
}

/**
 * Plan, tarjeta e historial de cobros de la clínica, para la sección de
 * Facturación de Ajustes.
 *
 * Lo del plan sale de nuestra base (la escribe el webhook de Stripe); la
 * tarjeta y los cobros se piden a Stripe en vivo. No se cachean ni se copian a
 * la base a propósito: son datos de los que Stripe es dueño, y una copia
 * nuestra desactualizada sobre cuánto se le cobró a alguien es peor que no
 * mostrar nada.
 *
 * Quién puede llamarlo lo decide el controlador (`read` sobre 'Cuenta' ⇒ solo
 * el titular). Este caso de uso no vuelve a comprobar el rol: duplicar la
 * regla en dos lugares es como terminan discrepando.
 */
@Injectable()
export class GetFacturacionUseCase {
  private readonly logger = new Logger(GetFacturacionUseCase.name);

  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly stripe: StripeService,
  ) {}

  async execute(): Promise<FacturacionView> {
    const tenant = await this.tenantDb.run(async (tx) => {
      const result = await tx.execute(sql`
        SELECT plan, subscription_status, billing_period, current_period_end, stripe_customer_id
          FROM tenants LIMIT 1
      `);
      return (result.rows as unknown as TenantRow[])[0];
    });

    const base = {
      plan: tenant?.plan ?? 'individual',
      subscriptionStatus: tenant?.subscription_status ?? 'none',
      billingPeriod: tenant?.billing_period ?? 'mensual',
      currentPeriodEnd: tenant?.current_period_end
        ? new Date(tenant.current_period_end).toISOString()
        : null,
    };

    // Cuentas de desarrollo y anteriores al self-serve: no hay nada que pedirle
    // a Stripe, y no es un error — es una clínica que nunca pasó por caja.
    if (!tenant?.stripe_customer_id) {
      return {
        ...base,
        sinCliente: true,
        metodoPago: null,
        pagoPendiente: null,
        pagos: [],
        historialDisponible: true,
      };
    }

    try {
      const [customer, invoices, abiertas] = await Promise.all([
        this.stripe.client.customers.retrieve(tenant.stripe_customer_id, {
          expand: ['invoice_settings.default_payment_method'],
        }),
        this.stripe.client.invoices.list({
          customer: tenant.stripe_customer_id,
          limit: MAX_PAGOS,
        }),
        // Consulta aparte y filtrada por Stripe en vez de buscar dentro de las
        // 12 recientes: una factura impagada puede ser más vieja que eso, y es
        // justo la que no puede quedar sin cobrar.
        this.stripe.client.invoices.list({
          customer: tenant.stripe_customer_id,
          status: 'open',
          limit: 1,
        }),
      ]);

      return {
        ...base,
        sinCliente: false,
        metodoPago: metodoDe(customer),
        pagoPendiente: aPagoPendiente(abiertas.data[0]),
        pagos: invoices.data.map(aPagoView),
        historialDisponible: true,
      };
    } catch (err) {
      // Que Stripe esté caído no debe tumbar la pantalla de Ajustes: el perfil
      // y la contraseña siguen siendo editables. Se devuelve el plan (que es
      // nuestro) y se marca el historial como no disponible para que la UI lo
      // diga en vez de fingir que no hay cobros.
      this.logger.error(`No se pudo leer la facturación en Stripe: ${(err as Error).message}`);
      return {
        ...base,
        sinCliente: false,
        metodoPago: null,
        pagoPendiente: null,
        pagos: [],
        historialDisponible: false,
      };
    }
  }
}

/**
 * La factura abierta convertida en "esto puedes pagarlo ya".
 *
 * Sin `hosted_invoice_url` no hay nada que ofrecer: mostrar un botón de pago
 * que no lleva a ningún lado es peor que no mostrarlo, sobre todo con la
 * cuenta suspendida.
 */
function aPagoPendiente(invoice: Stripe.Invoice | undefined): PagoPendienteView | null {
  if (!invoice?.hosted_invoice_url) return null;

  return {
    urlPago: invoice.hosted_invoice_url,
    // `amount_remaining` y no `amount_due`: si hubo un pago parcial o un
    // crédito, lo que el cliente debe es el resto, y cobrarle de más —aunque
    // sea solo en la pantalla— es la clase de error que cuesta la confianza.
    montoCentavos: invoice.amount_remaining ?? invoice.amount_due,
    moneda: invoice.currency.toUpperCase(),
    venceEl: invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : null,
  };
}

function metodoDe(customer: Stripe.Customer | Stripe.DeletedCustomer): MetodoPagoView | null {
  // Un cliente borrado en Stripe conserva el id en nuestra base pero ya no
  // tiene datos que mostrar.
  if (customer.deleted) return null;

  const pm = customer.invoice_settings?.default_payment_method;
  // Sin `expand` esto sería un id en texto; con expand viene el objeto. Si
  // llegara como string es que no se expandió, y no hay tarjeta que pintar.
  if (!pm || typeof pm === 'string' || !pm.card) return null;

  return {
    marca: pm.card.brand,
    ultimos4: pm.card.last4,
    expiraMes: pm.card.exp_month,
    expiraAnio: pm.card.exp_year,
  };
}

function aPagoView(invoice: Stripe.Invoice): PagoView {
  // `amount_paid` es 0 en las facturas abiertas o fallidas; ahí interesa
  // cuánto se INTENTÓ cobrar, que es lo que el titular está buscando cuando
  // revisa por qué le suspendieron la cuenta.
  const montoCentavos = invoice.amount_paid || invoice.amount_due;
  const pagadoEn = invoice.status_transitions?.paid_at ?? invoice.created;

  return {
    id: invoice.id ?? '',
    numero: invoice.number ?? null,
    fecha: new Date(pagadoEn * 1000).toISOString(),
    montoCentavos,
    moneda: invoice.currency.toUpperCase(),
    estatus: invoice.status ?? 'draft',
    urlRecibo: invoice.hosted_invoice_url ?? null,
  };
}
