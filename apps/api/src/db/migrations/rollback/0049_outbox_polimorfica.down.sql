-- Compensatoria de 0049. Sólo debe ejecutarse si Recall nunca produjo mensajes:
-- elimina esos trabajos para poder restaurar appointment_id NOT NULL.

DROP FUNCTION IF EXISTS claim_outbound_messages(int);
DROP TRIGGER IF EXISTS outbound_messages_subject_tenant ON outbound_messages;
DROP FUNCTION IF EXISTS check_outbound_message_subject_tenant();
DROP INDEX IF EXISTS outbound_messages_recall_attempt_idx;

DELETE FROM outbound_messages WHERE recall_attempt_id IS NOT NULL;
ALTER TABLE outbound_messages DROP CONSTRAINT IF EXISTS outbound_messages_sujeto_check;
ALTER TABLE outbound_messages DROP CONSTRAINT outbound_messages_kind_check;
ALTER TABLE outbound_messages ADD CONSTRAINT outbound_messages_kind_check
  CHECK (kind IN ('confirmation','reminder','rescheduled','cancelled'));
ALTER TABLE outbound_messages ALTER COLUMN appointment_id SET NOT NULL;
ALTER TABLE outbound_messages DROP COLUMN recall_attempt_id;

-- Restaura exactamente la versión estabilizada por 0043.
CREATE FUNCTION claim_outbound_messages(p_limit int DEFAULT 20)
RETURNS TABLE (
  id uuid, tenant_id uuid, channel text, kind text, clinic_name text,
  clinic_timezone text, destination text, appointment_id uuid,
  starts_at timestamptz, attempts int, idempotency_key text
) LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  WITH expired AS (
    UPDATE outbound_messages om SET status='uncertain',locked_at=NULL,
      last_error_code='lock_expired',updated_at=now()
     WHERE om.status='processing' AND om.locked_at<now()-interval '10 minutes'
    RETURNING om.tenant_id,om.appointment_id,om.id
  )
  INSERT INTO messaging_events(tenant_id,appointment_id,message_id,event)
  SELECT e.tenant_id,e.appointment_id,e.id,'uncertain' FROM expired e;

  RETURN QUERY
  WITH due AS (
    SELECT om.id FROM outbound_messages om
     WHERE om.status IN ('pending','failed') AND om.next_attempt_at<=now()
       AND om.scheduled_at<=now()
     ORDER BY om.next_attempt_at,om.created_at FOR UPDATE SKIP LOCKED
     LIMIT greatest(1,least(p_limit,100))
  ), claimed AS (
    UPDATE outbound_messages om SET status='processing',locked_at=now(),
      attempts=om.attempts+1,updated_at=now() FROM due WHERE om.id=due.id RETURNING om.*
  )
  SELECT c.id,c.tenant_id,c.channel,c.kind,t.nombre_clinica,
         coalesce(bs.timezone,'America/Mexico_City'),
         CASE WHEN c.channel='whatsapp' THEN p.telefono_normalizado ELSE p.email END,
         c.appointment_id,a.inicio_programado,c.attempts,c.idempotency_key
    FROM claimed c JOIN tenants t ON t.id=c.tenant_id
    LEFT JOIN booking_settings bs ON bs.tenant_id=c.tenant_id
    JOIN patients p ON p.id=c.patient_id JOIN appointments a ON a.id=c.appointment_id;
END $$;

GRANT EXECUTE ON FUNCTION claim_outbound_messages(int) TO healthflow_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='healthflow_worker') THEN
  GRANT EXECUTE ON FUNCTION claim_outbound_messages(int) TO healthflow_worker;
END IF; END $$;

DELETE FROM _migrations WHERE name='0049_outbox_polimorfica.sql';
