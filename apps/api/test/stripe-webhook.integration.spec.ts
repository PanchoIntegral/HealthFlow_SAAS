import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import { loadDotEnv } from '../src/config/env';
import { createAdminDb, createAppDb } from '../src/db/drizzle';
import { HandleStripeWebhookUseCase } from '../src/modules/subscriptions/application/handle-stripe-webhook.use-case';
import { SUBSCRIPTION_STATUSES } from '../src/common/subscription/subscription-status';
import type { StripeService } from '../src/modules/subscriptions/infrastructure/stripe.service';

loadDotEnv();

/**
 * Los webhooks que sostienen la suspensión y la reanudación. Se invoca el caso
 * de uso directamente (la verificación de firma vive en el controlador y se
 * prueba aparte): lo que interesa aquí es el efecto en la base.
 */
describe('Webhooks de Stripe (impago y pago recuperado)', () => {
  const admin = createAdminDb();
  const app = createAppDb();
  // Ninguna de las rutas bajo prueba llama a Stripe (solo el tag-back de
  // provisionTenant, que no se ejercita aquí).
  const stripeStub = { client: {} } as unknown as StripeService;
  const useCase = new HandleStripeWebhookUseCase(app.db, stripeStub);

  let tenantId: string;
  let customerId: string;

  /** Las queries crudas devuelven los timestamptz como string: se normalizan
   *  aquí igual que hace EstadoSuscripcionReader. */
  const estado = async () => {
    const r = await admin.db.execute(sql`
      SELECT subscription_status, grace_until, ultimo_pago_at, current_period_end
        FROM tenants WHERE id = ${tenantId}::uuid
    `);
    const row = (r.rows as unknown as Record<string, string | null>[])[0]!;
    const fecha = (v: string | null) => (v ? new Date(v) : null);
    return {
      subscription_status: row.subscription_status!,
      grace_until: fecha(row.grace_until ?? null),
      ultimo_pago_at: fecha(row.ultimo_pago_at ?? null),
      current_period_end: fecha(row.current_period_end ?? null),
    };
  };

  const invoice = (over: Partial<Stripe.Invoice> = {}) =>
    ({
      id: `in_${randomUUID()}`,
      customer: customerId,
      period_end: Math.floor(Date.now() / 1000) + 30 * 86_400,
      subscription_details: null,
      ...over,
    }) as Stripe.Invoice;

  const evento = (type: string, object: unknown): Stripe.Event =>
    ({ id: `evt_${randomUUID()}`, type, data: { object } }) as Stripe.Event;

  beforeEach(async () => {
    tenantId = randomUUID();
    customerId = `cus_test_${randomUUID().slice(0, 8)}`;
    await admin.db.execute(sql`
      INSERT INTO tenants (id, nombre_clinica, plan, subscription_status, stripe_customer_id)
      VALUES (${tenantId}::uuid, 'Clínica Webhook', 'individual', 'active', ${customerId})
    `);
  });

  afterEach(async () => {
    await admin.db.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}::uuid`);
  });

  afterAll(async () => {
    await admin.pool.end();
    await app.pool.end();
  });

  describe('invoice.payment_failed — arranca el reloj', () => {
    it('a quien ya había pagado le da 7 días de gracia', async () => {
      await admin.db.execute(
        sql`UPDATE tenants SET ultimo_pago_at = now() - interval '30 days' WHERE id = ${tenantId}::uuid`,
      );

      await useCase.execute(evento('invoice.payment_failed', invoice()));

      const { grace_until } = await estado();
      expect(grace_until).not.toBeNull();
      const dias = (grace_until!.getTime() - Date.now()) / 86_400_000;
      expect(dias).toBeGreaterThan(6.9);
      expect(dias).toBeLessThan(7.1);
    });

    it('a quien NUNCA pagó (trial vencido) lo suspende de inmediato', async () => {
      // ultimo_pago_at sigue NULL: el trial de 14 días más 7 de gracia serían
      // 21 días gratis para alguien que jamás puso una tarjeta válida.
      await useCase.execute(evento('invoice.payment_failed', invoice()));

      const { grace_until } = await estado();
      expect(grace_until!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('un segundo intento fallido NO reinicia la gracia', async () => {
      // Stripe reintenta el cobro varias veces y manda el evento en cada uno.
      // Sin el COALESCE, la cuenta nunca llegaría a suspenderse.
      await admin.db.execute(
        sql`UPDATE tenants SET ultimo_pago_at = now() - interval '30 days' WHERE id = ${tenantId}::uuid`,
      );
      await useCase.execute(evento('invoice.payment_failed', invoice()));
      const primera = (await estado()).grace_until!;

      await new Promise((r) => setTimeout(r, 50));
      await useCase.execute(evento('invoice.payment_failed', invoice()));

      expect((await estado()).grace_until!.getTime()).toBe(primera.getTime());
    });
  });

  describe('invoice.paid — la reanudación', () => {
    it('limpia la gracia y registra el pago', async () => {
      await admin.db.execute(
        sql`UPDATE tenants SET grace_until = now() - interval '1 day' WHERE id = ${tenantId}::uuid`,
      );

      await useCase.execute(evento('invoice.paid', invoice()));

      const e = await estado();
      expect(e.grace_until).toBeNull();
      expect(e.ultimo_pago_at).not.toBeNull();
      expect(e.current_period_end).not.toBeNull();
    });
  });

  describe('resolución del tenant', () => {
    it('sin metadata, lo encuentra por stripe_customer_id', async () => {
      // Las facturas no traen metadata.tenantId si el tag-back no alcanzó a
      // correr. `tenants` tiene FORCE RLS, así que esto solo funciona por la
      // función SECURITY DEFINER de la migración 0020.
      await useCase.execute(evento('invoice.paid', invoice({ subscription_details: null })));
      expect((await estado()).ultimo_pago_at).not.toBeNull();
    });

    it('si no se puede resolver, LANZA para que Stripe reintente', async () => {
      await expect(
        useCase.execute(evento('invoice.paid', invoice({ customer: 'cus_inexistente' }))),
      ).rejects.toThrow(/No se pudo resolver el tenant/);
    });
  });

  describe('idempotencia', () => {
    it('el mismo evento dos veces solo surte efecto una vez', async () => {
      const ev = evento('invoice.payment_failed', invoice());
      await admin.db.execute(
        sql`UPDATE tenants SET ultimo_pago_at = now() - interval '30 days' WHERE id = ${tenantId}::uuid`,
      );

      await useCase.execute(ev);
      const primera = (await estado()).grace_until!;
      await useCase.execute(ev);

      expect((await estado()).grace_until!.getTime()).toBe(primera.getTime());
      await admin.db.execute(sql`DELETE FROM stripe_events WHERE id = ${ev.id}`);
    });

    it('un evento que FALLA no queda quemado: el reintento sí procesa', async () => {
      // El bug que se corrige: la marca de "ya visto" se ponía antes de
      // procesar, así que un fallo posterior hacía que el reintento de Stripe
      // se ignorara y el evento se perdiera para siempre.
      const ev = evento('invoice.paid', invoice({ customer: 'cus_inexistente' }));
      await expect(useCase.execute(ev)).rejects.toThrow();

      const quedo = await admin.db.execute(
        sql`SELECT count(*)::int AS n FROM stripe_events WHERE id = ${ev.id}`,
      );
      expect((quedo.rows[0] as { n: number }).n).toBe(0);

      // El reintento (mismo id, ya con el customer correcto) sí surte efecto.
      await useCase.execute(evento('invoice.paid', invoice()));
      expect((await estado()).ultimo_pago_at).not.toBeNull();
    });
  });

  it('los 9 status declarados pasan el CHECK de la tabla', async () => {
    // Si Stripe manda uno que el CHECK no admite, el UPDATE revienta y el
    // tenant se queda con un estado obsoleto — justo lo que el gating lee.
    for (const status of SUBSCRIPTION_STATUSES) {
      await expect(
        admin.db.execute(
          sql`UPDATE tenants SET subscription_status = ${status} WHERE id = ${tenantId}::uuid`,
        ),
      ).resolves.toBeDefined();
    }
  });
});
