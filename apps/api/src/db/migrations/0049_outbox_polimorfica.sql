-- Entrega 2: la outbox sirve tanto para citas existentes como para intentos de
-- Recall. Se conserva UNA sola infraestructura de consentimiento, supresión,
-- reintentos y webhooks; duplicarla abriría dos caminos con reglas de privacidad
-- distintas.

ALTER TABLE outbound_messages ALTER COLUMN appointment_id DROP NOT NULL;
ALTER TABLE outbound_messages
  ADD COLUMN recall_attempt_id uuid REFERENCES recall_attempts(id) ON DELETE CASCADE;

ALTER TABLE outbound_messages DROP CONSTRAINT outbound_messages_kind_check;
ALTER TABLE outbound_messages ADD CONSTRAINT outbound_messages_kind_check
  CHECK (kind IN ('confirmation','reminder','rescheduled','cancelled','recall'));

-- Exactamente un sujeto. Nunca una fila huérfana y nunca un mensaje que pueda
-- atribuirse simultáneamente a una cita y a un recall.
ALTER TABLE outbound_messages ADD CONSTRAINT outbound_messages_sujeto_check
  CHECK (num_nonnulls(appointment_id, recall_attempt_id) = 1);
CREATE INDEX outbound_messages_recall_attempt_idx
  ON outbound_messages(recall_attempt_id) WHERE recall_attempt_id IS NOT NULL;

-- Las FKs simples comprueban existencia, pero no que todas las filas sean del
-- mismo tenant ni del mismo paciente. La outbox determina el destino del envío:
-- esa coherencia es una barrera de privacidad y no puede depender del caller.
CREATE FUNCTION check_outbound_message_subject_tenant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM patients p WHERE p.id=NEW.patient_id AND p.tenant_id=NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'patient does not belong to outbound message tenant' USING ERRCODE='23503';
  END IF;

  IF NEW.appointment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM appointments a
     WHERE a.id=NEW.appointment_id AND a.tenant_id=NEW.tenant_id
       AND a.patient_id=NEW.patient_id
  ) THEN
    RAISE EXCEPTION 'appointment does not belong to outbound message patient and tenant'
      USING ERRCODE='23503';
  END IF;

  IF NEW.recall_attempt_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM recall_attempts ra
      JOIN patient_recalls pr ON pr.id=ra.patient_recall_id
     WHERE ra.id=NEW.recall_attempt_id AND ra.tenant_id=NEW.tenant_id
       AND pr.tenant_id=NEW.tenant_id AND pr.patient_id=NEW.patient_id
  ) THEN
    RAISE EXCEPTION 'recall attempt does not belong to outbound message patient and tenant'
      USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outbound_messages_subject_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, patient_id, appointment_id, recall_attempt_id
  ON outbound_messages FOR EACH ROW EXECUTE FUNCTION check_outbound_message_subject_tenant();

-- La firma cambia, así que PostgreSQL exige DROP + CREATE. Los campos de cita
-- son nullable para kind=recall; booking_slug sólo lo usa ese caso.
DROP FUNCTION claim_outbound_messages(int);
CREATE FUNCTION claim_outbound_messages(p_limit int DEFAULT 20)
RETURNS TABLE (
  id uuid, tenant_id uuid, channel text, kind text, clinic_name text,
  clinic_timezone text, destination text, appointment_id uuid,
  recall_attempt_id uuid, starts_at timestamptz, booking_slug text,
  attempts int, idempotency_key text
) LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  -- Un worker que murió con el mensaje en vuelo no puede saber si el proveedor
  -- lo aceptó. La semántica sigue siendo at-most-once para citas y recalls.
  WITH expired AS (
    UPDATE outbound_messages om SET status='uncertain', locked_at=NULL,
      last_error_code='lock_expired', updated_at=now()
     WHERE om.status='processing' AND om.locked_at < now()-interval '10 minutes'
    RETURNING om.tenant_id, om.appointment_id, om.id
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
      attempts=om.attempts+1,updated_at=now()
      FROM due WHERE om.id=due.id RETURNING om.*
  )
  SELECT c.id,c.tenant_id,c.channel,c.kind,t.nombre_clinica,
         coalesce(bs.timezone,'America/Mexico_City'),
         CASE WHEN c.channel='whatsapp' THEN p.telefono_normalizado ELSE p.email END,
         c.appointment_id,c.recall_attempt_id,a.inicio_programado,bs.slug,
         c.attempts,c.idempotency_key
    FROM claimed c
    JOIN tenants t ON t.id=c.tenant_id
    LEFT JOIN booking_settings bs ON bs.tenant_id=c.tenant_id
    JOIN patients p ON p.id=c.patient_id AND p.tenant_id=c.tenant_id
    LEFT JOIN appointments a ON a.id=c.appointment_id AND a.tenant_id=c.tenant_id;
END $$;

GRANT EXECUTE ON FUNCTION claim_outbound_messages(int) TO healthflow_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='healthflow_worker') THEN
  GRANT EXECUTE ON FUNCTION claim_outbound_messages(int) TO healthflow_worker;
END IF; END $$;
