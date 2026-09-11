-- Fase A de los módulos dentales prioritarios: las tres piezas transversales
-- que el resto de los módulos (recalls, periodontograma, portal, laboratorio,
-- inventario, pagos, comisiones) da por supuestas.
--
--  1. `tenant_feature_flags` — liberación por etapas y rollback por clínica.
--     La AUSENCIA de fila es "apagado": un rollback borra la fila y el
--     histórico de la tabla de negocio queda intacto, como exige §5.8.
--
--  2. `app_events` — outbox INTERNA de eventos de aplicación. No es Kafka ni
--     `messaging_events` (que es entrega al paciente): esto comunica módulos
--     entre sí (§14). Append-only: sin UPDATE ni DELETE para la aplicación.
--
--  3. `app_event_consumptions` — idempotencia por (event_id, consumer). La
--     garantía de "exactamente una vez por consumidor" vive en la LLAVE
--     PRIMARIA, no en el código del worker.

-- ── 1. Feature flags por tenant ──────────────────────────────────
CREATE TABLE tenant_feature_flags (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
    DEFAULT current_tenant_id(),
  -- Sin CHECK contra una lista cerrada a propósito: el catálogo vive en
  -- shared-types (FEATURE_FLAGS) y agregar un flag no debe costar una
  -- migración. El formato sí se valida, para que nadie meta texto libre.
  flag text NOT NULL CHECK (flag ~ '^[a-z][a-z0-9_]{2,63}$'),
  habilitado boolean NOT NULL DEFAULT false,
  habilitado_at timestamptz,
  habilitado_por uuid REFERENCES users(id),
  notas text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, flag)
);

-- El usuario que prende/apaga tiene que ser de la misma clínica. La FK sola no
-- alcanza: las comprobaciones de llave foránea NO pasan por RLS.
CREATE OR REPLACE FUNCTION check_feature_flag_actor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.habilitado_por IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.habilitado_por AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'actor does not belong to feature flag tenant' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tenant_feature_flags_actor
  BEFORE INSERT OR UPDATE ON tenant_feature_flags
  FOR EACH ROW EXECUTE FUNCTION check_feature_flag_actor();

-- ── 2. Eventos internos de aplicación (outbox interna) ───────────
CREATE TABLE app_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
    DEFAULT current_tenant_id(),
  -- 'appointment.scheduled', 'recall.due', … Catálogo tipado en shared-types.
  tipo text NOT NULL CHECK (tipo ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  version int NOT NULL DEFAULT 1 CHECK (version >= 1),
  entidad text NOT NULL,
  entidad_id uuid,
  -- Payload MÍNIMO: identificadores y estado, nunca nota clínica, teléfono,
  -- correo ni mediciones. Lo hace cumplir el dominio (app-event.types.ts);
  -- aquí solo se acota el tamaño para que una fuga accidental no crezca.
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (pg_column_size(payload) <= 4096),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  -- Permite emitir un evento con efecto diferido sin una tabla de agenda aparte.
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_events_pendientes_idx ON app_events(available_at, occurred_at, id);
CREATE INDEX app_events_tenant_tipo_idx ON app_events(tenant_id, tipo, occurred_at DESC);

CREATE TABLE app_event_consumptions (
  event_id uuid NOT NULL REFERENCES app_events(id) ON DELETE CASCADE,
  consumer text NOT NULL CHECK (consumer ~ '^[a-z][a-z0-9_.-]{2,63}$'),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
    DEFAULT current_tenant_id(),
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing','done','failed','dead')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- La idempotencia del §14 ("consumidores idempotentes por event_id + consumer")
  -- es ESTA llave primaria. Nada en el worker puede saltársela.
  PRIMARY KEY (event_id, consumer)
);
CREATE INDEX app_event_consumptions_pendientes_idx
  ON app_event_consumptions(consumer, next_attempt_at)
  WHERE status IN ('processing','failed');

CREATE OR REPLACE FUNCTION check_app_event_consumption_tenant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app_events WHERE id = NEW.event_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'event does not belong to consumption tenant' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER app_event_consumptions_tenant
  BEFORE INSERT OR UPDATE ON app_event_consumptions
  FOR EACH ROW EXECUTE FUNCTION check_app_event_consumption_tenant();

-- ── RLS ──────────────────────────────────────────────────────────
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_feature_flags','app_events','app_event_consumptions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_feature_flags TO healthflow_app;
-- app_events es APPEND-ONLY: la aplicación emite y lee, jamás reescribe la
-- historia. El avance del consumidor vive en app_event_consumptions.
--
-- El REVOKE no es redundante: 0001_rls concede ALL sobre las tablas del
-- esquema al rol de la app, así que sin quitarlo explícitamente el GRANT de
-- arriba no restringe nada. Mismo motivo que el REVOKE de `consentimientos`
-- en 0015 — y la misma trampa: una tabla nueva NACE con esos permisos.
GRANT SELECT, INSERT ON app_events TO healthflow_app;
REVOKE UPDATE, DELETE ON app_events FROM healthflow_app;
-- Una consumición avanza (processing → done/failed) pero no se borra: es la
-- prueba de que un evento ya se procesó.
REVOKE DELETE ON app_event_consumptions FROM healthflow_app;
GRANT SELECT, INSERT, UPDATE ON app_event_consumptions TO healthflow_app;

-- ── 3. Despacho: reclamar y cerrar eventos ───────────────────────
-- Mismo patrón que claim_outbound_messages: SECURITY DEFINER porque el worker
-- cruza tenants, y la exclusión mutua la da el índice único de la consumición
-- (ON CONFLICT), no un lock explícito sobre la tabla append-only.
CREATE FUNCTION claim_app_events(p_consumer text, p_limit int DEFAULT 20)
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
            OR (c.status = 'failed' AND c.next_attempt_at <= now())
            -- Reclamo colgado: el worker murió a mitad del trabajo.
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
     WHERE app_event_consumptions.status = 'failed'
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

-- Cierra el reclamo. Un fallo reintenta con backoff exponencial y muere a los
-- 8 intentos: un consumidor roto no debe girar para siempre sobre el mismo
-- evento ni bloquear la cola de los demás.
CREATE FUNCTION complete_app_event(
  p_event_id uuid, p_consumer text, p_ok boolean, p_error_code text DEFAULT NULL
) RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE app_event_consumptions SET
    status = CASE WHEN p_ok THEN 'done'
                  WHEN attempts >= 8 THEN 'dead'
                  ELSE 'failed' END,
    processed_at = CASE WHEN p_ok THEN now() ELSE processed_at END,
    last_error_code = CASE WHEN p_ok THEN NULL ELSE left(p_error_code, 80) END,
    next_attempt_at = CASE WHEN p_ok THEN next_attempt_at
                           ELSE now() + (interval '1 minute' * power(3, least(attempts, 5))) END,
    updated_at = now()
  WHERE event_id = p_event_id AND consumer = p_consumer
$$;

GRANT EXECUTE ON FUNCTION claim_app_events(text, int) TO healthflow_app;
GRANT EXECUTE ON FUNCTION complete_app_event(uuid, text, boolean, text) TO healthflow_app;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='healthflow_worker') THEN
    GRANT EXECUTE ON FUNCTION claim_app_events(text, int) TO healthflow_worker;
    GRANT EXECUTE ON FUNCTION complete_app_event(uuid, text, boolean, text) TO healthflow_worker;
  END IF;
END $$;
