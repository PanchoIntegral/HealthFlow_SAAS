-- Migración COMPENSATORIA de 0047. No la aplica db:migrate; se ejecuta a mano
-- como rol admin. Deja el sistema en el estado de 0046: la configuración del
-- titular vuelve a ser el único eje, y se pierde el registro de qué contrató
-- cada clínica. Los eventos aplazados vuelven a 'failed' para que el backoff
-- normal los recoja en vez de quedar en un estado que ya no existe.

UPDATE app_event_consumptions SET status='failed' WHERE status='deferred';

DROP FUNCTION IF EXISTS defer_app_event(uuid, text, text, interval);
ALTER TABLE app_event_consumptions DROP COLUMN IF EXISTS deferrals;
ALTER TABLE app_event_consumptions DROP CONSTRAINT IF EXISTS app_event_consumptions_status_check;
ALTER TABLE app_event_consumptions
  ADD CONSTRAINT app_event_consumptions_status_check
  CHECK (status IN ('processing','done','failed','dead'));
DROP INDEX IF EXISTS app_event_consumptions_pendientes_idx;
CREATE INDEX app_event_consumptions_pendientes_idx
  ON app_event_consumptions(consumer, next_attempt_at)
  WHERE status IN ('processing','failed');

-- Restaura el reclamo de 0046 (sin aplazados).
CREATE OR REPLACE FUNCTION claim_app_events(p_consumer text, p_limit int DEFAULT 20)
RETURNS TABLE (
  id uuid, tenant_id uuid, tipo text, version int, entidad text,
  entidad_id uuid, payload jsonb, occurred_at timestamptz, attempts int
) LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  WITH candidatos AS (
    SELECT e.id FROM app_events e
     LEFT JOIN app_event_consumptions c ON c.event_id = e.id AND c.consumer = p_consumer
     WHERE e.available_at <= now()
       AND (c.event_id IS NULL
            OR (c.status = 'failed' AND c.next_attempt_at <= now())
            OR (c.status = 'processing' AND c.updated_at < now() - interval '10 minutes'))
     ORDER BY e.occurred_at, e.id
     LIMIT greatest(1, least(p_limit, 100))
  ), reclamados AS (
    INSERT INTO app_event_consumptions
      (event_id, consumer, tenant_id, status, attempts, next_attempt_at, updated_at)
    SELECT e.id, p_consumer, e.tenant_id, 'processing', 1, now(), now()
      FROM candidatos k JOIN app_events e ON e.id = k.id
    ON CONFLICT (event_id, consumer) DO UPDATE
       SET status = 'processing', attempts = app_event_consumptions.attempts + 1, updated_at = now()
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

-- Devuelve los permisos de tabla que 0047 recortó a columnas.
REVOKE INSERT, UPDATE ON tenant_feature_flags FROM healthflow_app;
GRANT INSERT, UPDATE, DELETE ON tenant_feature_flags TO healthflow_app;

ALTER TABLE tenant_feature_flags
  DROP COLUMN IF EXISTS rollout_habilitado,
  DROP COLUMN IF EXISTS rollout_nota,
  DROP COLUMN IF EXISTS rollout_cambiado_at;

DROP TABLE IF EXISTS tenant_module_entitlements;
DROP FUNCTION IF EXISTS check_entitlement_actor();

DELETE FROM _migrations WHERE name = '0047_module_entitlements.sql';
