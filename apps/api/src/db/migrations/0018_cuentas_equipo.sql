-- ═══════════════════════════════════════════════════════════════════
-- Cuentas del equipo: el titular da de alta a los demás médicos y a su
-- asistente, dentro de los cupos que vende su plan (ver LIMITES_PLAN en
-- shared-types).
--
-- Todo cuelga del mismo tenant, así que las cuentas nuevas comparten clínica,
-- pacientes y agenda con el titular — que es justo lo que se contrata. El
-- aislamiento entre clínicas lo sigue dando RLS, sin cambios.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE users
  -- Baja lógica y NO borrado: un usuario borrado dejaría citas, notas
  -- clínicas y facturas apuntando a un id inexistente, y el expediente debe
  -- poder decir para siempre quién firmó. Desactivar libera el cupo del plan
  -- e impide el login; el historial queda intacto.
  ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true,
  -- Quién dio de alta la cuenta. ON DELETE SET NULL: la trazabilidad no debe
  -- impedir borrar nunca al creador.
  ADD COLUMN IF NOT EXISTS creado_por uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Médico al que asiste. Es lo que hace que la cuenta del asistente esté
  -- "ligada" a un doctor concreto y no suelta en la clínica.
  ADD COLUMN IF NOT EXISTS medico_titular_id uuid REFERENCES users(id) ON DELETE SET NULL;

-- Solo un asistente asiste a alguien. Un médico con medico_titular_id sería un
-- dato sin significado que tarde o temprano alguien interpretaría mal.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_medico_titular_solo_asistente'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_medico_titular_solo_asistente
      CHECK (medico_titular_id IS NULL OR rol = 'asistente');
  END IF;
END $$;

-- El conteo de cupos filtra por rol y por activo en CADA carga de la pantalla
-- de cuentas y en cada alta.
CREATE INDEX IF NOT EXISTS users_tenant_rol_activo_idx ON users(tenant_id, rol, activo);

-- Autocompleta tenant_id con el tenant activo de la transacción, igual que
-- patients y appointments (ver 0003 y 0005). Dar de alta a un compañero pasa
-- ahora por la API con un tenant ya fijado: el insert no puede —ni necesita—
-- nombrar una clínica ajena. Los dos altas que sí pasan el tenant a mano (el
-- webhook de Stripe y create-account.ts) crean el tenant en esa misma
-- transacción y siguen funcionando igual.
ALTER TABLE users ALTER COLUMN tenant_id SET DEFAULT current_tenant_id();

-- ── Login de una cuenta desactivada ──────────────────────────────
--
-- Se filtra AQUÍ, en la única lectura cross-tenant del login, y no en el
-- servicio: así una cuenta dada de baja es indistinguible de una que no
-- existe (mismo mensaje genérico, mismo tiempo de respuesta gracias al
-- compareAgainstDummy). Sin cambio de firma — solo el WHERE.
CREATE OR REPLACE FUNCTION auth_find_user_by_email(p_email text)
  RETURNS TABLE (id uuid, tenant_id uuid, password_hash text, nombre text, rol text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT id, tenant_id, password_hash, nombre, rol
    FROM users
   WHERE email = p_email
     AND activo
$$;

-- Y por el mismo motivo, una cuenta desactivada tampoco recibe enlaces de
-- restablecimiento: sería una puerta trasera al login que acabamos de cerrar.
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
     AND u.activo
   LIMIT 3
$$;
