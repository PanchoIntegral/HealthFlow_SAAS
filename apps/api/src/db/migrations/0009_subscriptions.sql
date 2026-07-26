-- ═══════════════════════════════════════════════════════════════════
-- Suscripciones (Stripe). Cobra el acceso a HealthFlow mismo — NO confundir
-- con el módulo `billing` (facturación CFDI/SAT de las clínicas a sus
-- pacientes), que es un dominio completamente distinto.
--
-- El tenant + usuario se crean SOLO cuando Stripe confirma el checkout (ver
-- handle-stripe-webhook.use-case.ts). Antes de eso no existe ninguna fila:
-- los datos del registro viajan en la metadata de la Checkout Session.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE tenants
  ADD COLUMN stripe_customer_id text UNIQUE,
  ADD COLUMN stripe_subscription_id text UNIQUE,
  ADD COLUMN subscription_status text NOT NULL DEFAULT 'none'
    CHECK (subscription_status IN ('none', 'trialing', 'active', 'past_due', 'canceled', 'unpaid'));

-- Idempotencia de webhooks: Stripe puede reintentar la misma entrega. Sin
-- tenant_id ni RLS — es un registro global de eventos ya procesados, igual
-- que cie10_diagnosticos.
CREATE TABLE IF NOT EXISTS stripe_events (
  id         text PRIMARY KEY,
  type       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Token de un solo uso para el "auto-login" tras pagar: el browser llega a
-- /bienvenida solo con el session_id de Stripe (sin tenant conocido), y
-- redeem_onboarding_ticket() lo canjea de forma atómica por la sesión real.
CREATE TABLE IF NOT EXISTS onboarding_tickets (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  user_id                     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_checkout_session_id  text NOT NULL UNIQUE,
  expires_at                  timestamptz NOT NULL,
  consumed_at                 timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE onboarding_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_tickets FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON onboarding_tickets
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Canjea un ticket de onboarding por los datos de sesión, en una sola llamada
-- atómica (evita una carrera entre "leer si es válido" y "marcar consumido").
-- SECURITY DEFINER porque el browser no conoce el tenant en este punto — mismo
-- patrón que auth_find_user_by_email (0002_auth_login.sql).
CREATE OR REPLACE FUNCTION redeem_onboarding_ticket(p_session_id text)
  RETURNS TABLE (status text, user_id uuid, tenant_id uuid, nombre text, rol text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_ticket onboarding_tickets%ROWTYPE;
BEGIN
  SELECT * INTO v_ticket FROM onboarding_tickets t WHERE t.stripe_checkout_session_id = p_session_id;

  IF NOT FOUND THEN
    -- Aún no llega el webhook de Stripe: el frontend debe seguir esperando.
    RETURN QUERY SELECT 'pending'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF v_ticket.consumed_at IS NOT NULL OR v_ticket.expires_at <= now() THEN
    RETURN QUERY SELECT 'expired'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  UPDATE onboarding_tickets SET consumed_at = now() WHERE id = v_ticket.id;

  RETURN QUERY
    SELECT 'ok'::text, u.id, u.tenant_id, u.nombre, u.rol
      FROM users u
     WHERE u.id = v_ticket.user_id;
END;
$$;

REVOKE ALL ON FUNCTION redeem_onboarding_ticket(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redeem_onboarding_ticket(text) TO healthflow_app;
