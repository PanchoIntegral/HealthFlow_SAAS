-- ═══════════════════════════════════════════════════════════════════
-- Restablecer contraseña ("olvidé mi contraseña").
--
-- Mismo problema que resuelve onboarding_tickets (0009_subscriptions.sql): el
-- navegador llega por un link de correo, sin tenant conocido. Mismo molde:
-- token de un solo uso, canjeado atómicamente vía función SECURITY DEFINER.
--
-- El email es único POR TENANT, no global (UNIQUE(tenant_id, email) en
-- 0000_init.sql) — la misma persona puede tener cuentas en varias clínicas
-- con el mismo correo, exactamente como ya maneja auth_find_user_by_email()
-- en el login (hasta 3 filas). Por eso la búsqueda y la creación del token
-- están en DOS funciones separadas: cada cuenta candidata necesita su PROPIO
-- token (token_hash es UNIQUE — no se puede insertar el mismo hash para dos
-- cuentas), así que Node genera un token distinto por candidato y llama
-- create_password_reset_token() una vez por cada uno.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Hash SHA-256 del token (no el token crudo): igual que una contraseña, si
  -- la base se filtra no debe entregar tokens de reset válidos de regalo.
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Sin DEFAULT current_tenant_id(): se inserta desde una función SECURITY
-- DEFINER que corre ANTES de que exista un tenant conocido en la sesión.

CREATE INDEX IF NOT EXISTS password_reset_tokens_tenant_idx ON password_reset_tokens(tenant_id);

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'password_reset_tokens' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON password_reset_tokens
      USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

-- Cuentas candidatas para ese email (tope 3, igual que MAX_HASH_COMPARISONS
-- del login). Solo lectura — SECURITY DEFINER porque quien pide el reset no
-- tiene tenant conocido, mismo patrón que auth_find_user_by_email (0002).
CREATE OR REPLACE FUNCTION find_password_reset_candidates(p_email text)
  RETURNS TABLE (user_id uuid, tenant_id uuid, nombre text, nombre_clinica text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT u.id, u.tenant_id, u.nombre, t.nombre_clinica
    FROM users u
    JOIN tenants t ON t.id = u.tenant_id
   WHERE u.email = p_email
   LIMIT 3
$$;

REVOKE ALL ON FUNCTION find_password_reset_candidates(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_password_reset_candidates(text) TO healthflow_app;

-- Inserta UN token para UNA cuenta específica. Se llama una vez por cada fila
-- que devolvió find_password_reset_candidates(), con un token distinto por
-- llamada (Node lo genera y lo hashea antes de mandarlo aquí).
CREATE OR REPLACE FUNCTION create_password_reset_token(
  p_user_id uuid, p_tenant_id uuid, p_token_hash text, p_expires_at timestamptz
) RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
AS $$
  INSERT INTO password_reset_tokens (tenant_id, user_id, token_hash, expires_at)
  VALUES (p_tenant_id, p_user_id, p_token_hash, p_expires_at)
$$;

REVOKE ALL ON FUNCTION create_password_reset_token(uuid, uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_password_reset_token(uuid, uuid, text, timestamptz) TO healthflow_app;

-- Canjea el token: valida, marca consumido y actualiza password_hash en una
-- sola llamada atómica (evita la carrera leer-válido / marcar-consumido).
-- Mismo patrón que redeem_onboarding_ticket (0009).
CREATE OR REPLACE FUNCTION redeem_password_reset_token(p_token_hash text, p_new_password_hash text)
  RETURNS TABLE (status text, user_id uuid, tenant_id uuid, nombre text, rol text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_token password_reset_tokens%ROWTYPE;
BEGIN
  SELECT * INTO v_token FROM password_reset_tokens t WHERE t.token_hash = p_token_hash;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalido'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF v_token.consumed_at IS NOT NULL OR v_token.expires_at <= now() THEN
    RETURN QUERY SELECT 'expirado'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  UPDATE password_reset_tokens SET consumed_at = now() WHERE id = v_token.id;
  UPDATE users SET password_hash = p_new_password_hash WHERE id = v_token.user_id;

  RETURN QUERY
    SELECT 'ok'::text, u.id, u.tenant_id, u.nombre, u.rol
      FROM users u
     WHERE u.id = v_token.user_id;
END;
$$;

REVOKE ALL ON FUNCTION redeem_password_reset_token(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redeem_password_reset_token(text, text) TO healthflow_app;
