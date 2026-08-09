-- ═══════════════════════════════════════════════════════════════════
-- Gating de suscripción: qué pasa cuando la clínica deja de pagar.
--
-- Hasta 0019 el estado de Stripe se guardaba pero nadie lo leía: una clínica
-- que dejaba de pagar conservaba acceso completo. Aquí se agregan los datos
-- que faltaban para poder DERIVAR el estado de acceso en cada petición
-- (ver common/subscription/debe-restringir.ts).
--
-- La política: al fallar el cobro hay 7 días de gracia; agotados, la cuenta
-- queda en SOLO LECTURA (consultar sí, escribir no). Al pagar se reanuda sola.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE tenants
  -- Fin del periodo ya pagado, según Stripe. Informativo para la UI
  -- ("tu plan se renueva el …"); el gating no depende de él.
  ADD COLUMN current_period_end timestamptz,
  -- Hasta cuándo se tolera el impago. Lo fija invoice.payment_failed y lo
  -- limpia invoice.paid. NULL = no hay impago pendiente.
  ADD COLUMN grace_until        timestamptz,
  -- Distingue "nunca pagó" (trial de 14 días vencido sin tarjeta válida) de
  -- "pagaba y se le venció la tarjeta". Solo el segundo merece la gracia:
  -- si no, el trial de 14 + 7 de gracia daría 21 días gratis a quien nunca
  -- tuvo intención de pagar.
  ADD COLUMN ultimo_pago_at     timestamptz;

-- El CHECK de 0009 solo admitía 6 valores, pero syncSubscriptionStatus escribe
-- el status CRUDO que manda Stripe: 'incomplete', 'incomplete_expired' y
-- 'paused' hacían reventar el UPDATE del webhook. Bug latente preexistente —
-- ahora que el gating depende de este campo, un UPDATE fallido dejaría a la
-- clínica en un estado obsoleto, así que se corrige aquí.
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_subscription_status_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_subscription_status_check
  CHECK (subscription_status IN (
    'none', 'trialing', 'active', 'past_due', 'canceled',
    'unpaid', 'incomplete', 'incomplete_expired', 'paused'
  ));

-- Idempotencia de webhooks, segunda vuelta. La fila se insertaba ANTES de
-- procesar y en su propia transacción: si el handler fallaba después, el
-- evento quedaba marcado como visto y el reintento de Stripe se ignoraba —
-- perdiéndolo para siempre. Con processed_at el handler puede borrar su
-- propia marca al fallar, dejando que el reintento sí haga efecto.
ALTER TABLE stripe_events ADD COLUMN processed_at timestamptz;
UPDATE stripe_events SET processed_at = created_at WHERE processed_at IS NULL;

-- Los eventos de factura (invoice.payment_failed / invoice.paid) no siempre
-- traen metadata.tenantId, y `tenants` tiene FORCE ROW LEVEL SECURITY: sin
-- tenant fijado no se ve ninguna fila. Este lookup por customer es el fallback
-- para resolver a quién pertenece el evento. Mismo patrón que
-- auth_find_user_by_email (0002) y redeem_onboarding_ticket (0009).
CREATE OR REPLACE FUNCTION stripe_tenant_by_customer(p_customer_id text)
  RETURNS uuid
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT id FROM tenants WHERE stripe_customer_id = p_customer_id;
$$;

REVOKE ALL ON FUNCTION stripe_tenant_by_customer(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION stripe_tenant_by_customer(text) TO healthflow_app;
