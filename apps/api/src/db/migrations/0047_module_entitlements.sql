-- Entrega 0: separar QUÉ COMPRÓ la clínica de QUÉ LE LIBERAMOS y de QUÉ QUIERE
-- USAR. Hasta ahora `tenant_feature_flags.habilitado` mezclaba las tres cosas,
-- y el titular podía encender por API un módulo que nunca contrató.
--
--   disponible = suscripcion_vigente
--                AND entitlement_contratado   ← esta migración
--                AND rollout_habilitado       ← esta migración
--                AND configuracion_activa     ← ya existía
--
-- Incluye además el estado `deferred` de las consumiciones de eventos: sin él,
-- todo lo que ocurra mientras un módulo está apagado se perdería (ver ADR 0004,
-- "Reconciliación"). NO modifica 0046; altera las tablas que 0046 creó.

-- ── 1. Derechos contratados ──────────────────────────────────────
CREATE TABLE tenant_module_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
    DEFAULT current_tenant_id(),
  module_key text NOT NULL CHECK (module_key ~ '^[a-z][a-z0-9_]{2,63}$'),
  source text NOT NULL CHECK (source IN ('plan','addon','trial','manual')),
  status text NOT NULL CHECK (status IN ('active','trialing','suspended','expired')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  granted_by uuid REFERENCES users(id),
  -- Referencia comercial (id de suscripción, folio del acuerdo). Nunca datos
  -- clínicos ni de contacto: lo hace cumplir el dominio antes de escribir.
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (pg_column_size(metadata) <= 2048),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

-- Un solo derecho VIVO por módulo. Los vencidos y suspendidos se conservan:
-- son el historial de qué tuvo contratado la clínica y hasta cuándo.
CREATE UNIQUE INDEX tenant_module_entitlements_vivo_idx
  ON tenant_module_entitlements (tenant_id, module_key)
  WHERE status IN ('active','trialing');
CREATE INDEX tenant_module_entitlements_lookup_idx
  ON tenant_module_entitlements (tenant_id, module_key, status);

-- Quien concede tiene que ser de la misma clínica cuando es un usuario. La FK
-- sola no alcanza: las comprobaciones de llave foránea NO pasan por RLS.
CREATE OR REPLACE FUNCTION check_entitlement_actor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.granted_by IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.granted_by AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'actor does not belong to entitlement tenant' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tenant_module_entitlements_actor
  BEFORE INSERT OR UPDATE ON tenant_module_entitlements
  FOR EACH ROW EXECUTE FUNCTION check_entitlement_actor();

ALTER TABLE tenant_module_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_module_entitlements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_module_entitlements
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- La API SOLO LEE. Que un administrador de clínica no pueda concederse un
-- módulo no depende de un `if` en el código ni de que CASL esté bien puesto:
-- el rol de la aplicación no tiene el permiso. El REVOKE es imprescindible
-- porque 0001_rls concede ALL sobre el esquema y una tabla nueva nace con eso.
GRANT SELECT ON tenant_module_entitlements TO healthflow_app;
REVOKE INSERT, UPDATE, DELETE ON tenant_module_entitlements FROM healthflow_app;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='healthflow_worker') THEN
  GRANT SELECT ON tenant_module_entitlements TO healthflow_worker;
END IF; END $$;

-- ── 2. Rollout: interruptor de operación de HealthFlow ───────────
-- DEFAULT true a propósito: no es un "encender", es un KILL SWITCH. Los
-- pilotos se controlan con el entitlement (source='trial'), que ya limita a
-- quién le llega. Este interruptor existe para apagar un módulo en una clínica
-- concreta durante un incidente, sin tocar lo que compró ni lo que configuró.
ALTER TABLE tenant_feature_flags
  ADD COLUMN rollout_habilitado boolean NOT NULL DEFAULT true,
  ADD COLUMN rollout_nota text,
  ADD COLUMN rollout_cambiado_at timestamptz;

-- La clínica cambia `habilitado` (su configuración). `rollout_habilitado` es
-- de HealthFlow y se escribe con el script db:grant-module, como rol admin.
--
-- OJO con el orden: revocar SOLO las columnas no sirve de nada mientras siga
-- vigente el GRANT a nivel de TABLA que dejó 0001_rls — un permiso de tabla
-- autoriza cualquier columna, y el REVOKE por columna no lo recorta. Hay que
-- quitar el permiso de tabla y volver a concederlo columna por columna.
REVOKE UPDATE, INSERT ON tenant_feature_flags FROM healthflow_app;
GRANT INSERT (flag, habilitado, habilitado_at, habilitado_por, notas)
  ON tenant_feature_flags TO healthflow_app;
GRANT UPDATE (habilitado, habilitado_at, habilitado_por, notas, updated_at)
  ON tenant_feature_flags TO healthflow_app;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='healthflow_worker') THEN
  GRANT SELECT ON tenant_feature_flags TO healthflow_worker;
END IF; END $$;

-- ── 3. Reconciliación de eventos de un módulo apagado ────────────
-- Un consumidor cuyo módulo no está disponible no falla ni cierra el evento:
-- lo APLAZA. Encender el módulo lo reconcilia solo en la siguiente vuelta.
ALTER TABLE app_event_consumptions
  DROP CONSTRAINT app_event_consumptions_status_check;
ALTER TABLE app_event_consumptions
  ADD CONSTRAINT app_event_consumptions_status_check
  CHECK (status IN ('processing','done','failed','dead','deferred'));
-- Contador aparte: un aplazamiento NO es un fallo y no debe gastar el
-- presupuesto de reintentos que lleva a 'dead'.
ALTER TABLE app_event_consumptions
  ADD COLUMN deferrals int NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS app_event_consumptions_pendientes_idx;
CREATE INDEX app_event_consumptions_pendientes_idx
  ON app_event_consumptions(consumer, next_attempt_at)
  WHERE status IN ('processing','failed','deferred');

-- Reclamo: ahora también recoge los aplazados cuyo turno llegó.
CREATE OR REPLACE FUNCTION claim_app_events(p_consumer text, p_limit int DEFAULT 20)
RETURNS TABLE (
  id uuid, tenant_id uuid, tipo text, version int, entidad text,
  entidad_id uuid, payload jsonb, occurred_at timestamptz, attempts int
) LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  WITH candidatos AS (
    SELECT e.id FROM app_events e
     LEFT JOIN app_event_consumptions c
       ON c.event_id = e.id AND c.consumer = p_consumer
     WHERE e.available_at <= now()
       AND (c.event_id IS NULL
            OR (c.status IN ('failed','deferred') AND c.next_attempt_at <= now())
            OR (c.status = 'processing' AND c.updated_at < now() - interval '10 minutes'))
     ORDER BY e.occurred_at, e.id
     LIMIT greatest(1, least(p_limit, 100))
  ), reclamados AS (
    INSERT INTO app_event_consumptions
      (event_id, consumer, tenant_id, status, attempts, next_attempt_at, updated_at)
    SELECT e.id, p_consumer, e.tenant_id, 'processing', 1, now(), now()
      FROM candidatos k JOIN app_events e ON e.id = k.id
    ON CONFLICT (event_id, consumer) DO UPDATE
       SET status = 'processing',
           attempts = app_event_consumptions.attempts + 1,
           updated_at = now()
     WHERE app_event_consumptions.status IN ('failed','deferred')
           AND app_event_consumptions.next_attempt_at <= now()
        OR app_event_consumptions.status = 'processing'
           AND app_event_consumptions.updated_at < now() - interval '10 minutes'
    RETURNING app_event_consumptions.event_id, app_event_consumptions.attempts
  )
  SELECT e.id, e.tenant_id, e.tipo, e.version, e.entidad, e.entidad_id,
         e.payload, e.occurred_at, r.attempts
    FROM reclamados r JOIN app_events e ON e.id = r.event_id
   ORDER BY e.occurred_at, e.id
$$;

-- Aplaza un evento para reconciliarlo cuando el módulo vuelva. Devuelve el
-- reintento por omisión a un día: nadie enciende un módulo esperando que
-- reaccione en segundos a algo de la semana pasada.
--
-- Ventana de 90 días desde que ocurrió: pasado ese plazo el evento deja de ser
-- accionable (un recall de una limpieza de hace cuatro meses no sirve) y se
-- cierra como 'dead' para que la cola no crezca sin límite.
CREATE FUNCTION defer_app_event(
  p_event_id uuid, p_consumer text, p_motivo text,
  p_reintentar_en interval DEFAULT interval '1 day'
) RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE app_event_consumptions c SET
    status = CASE WHEN e.occurred_at < now() - interval '90 days' THEN 'dead' ELSE 'deferred' END,
    last_error_code = CASE WHEN e.occurred_at < now() - interval '90 days'
                           THEN 'reconciliation_window_expired' ELSE left(p_motivo, 80) END,
    -- El reclamo sumó un intento; un aplazamiento no gasta reintentos.
    attempts = greatest(c.attempts - 1, 0),
    deferrals = c.deferrals + 1,
    next_attempt_at = now() + p_reintentar_en,
    updated_at = now()
  FROM app_events e
  WHERE c.event_id = p_event_id AND c.consumer = p_consumer AND e.id = c.event_id
$$;

GRANT EXECUTE ON FUNCTION defer_app_event(uuid, text, text, interval) TO healthflow_app;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='healthflow_worker') THEN
  GRANT EXECUTE ON FUNCTION defer_app_event(uuid, text, text, interval) TO healthflow_worker;
END IF; END $$;
