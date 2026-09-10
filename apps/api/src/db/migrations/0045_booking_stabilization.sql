-- Estabiliza instalaciones donde 0044 ya fue aplicada antes de corregirla.
-- La migración es aditiva e idempotente para despliegues existentes.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS confirmada_at timestamptz;

CREATE OR REPLACE FUNCTION apply_patient_consent_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM patients
     WHERE id=NEW.patient_id AND tenant_id=NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'patient does not belong to consent tenant'
      USING ERRCODE='23503';
  END IF;
  IF NEW.actor_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users
     WHERE id=NEW.actor_user_id AND tenant_id=NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'actor does not belong to consent tenant'
      USING ERRCODE='23503';
  END IF;

  IF NEW.tipo='whatsapp' THEN
    IF NEW.accion='otorgado' THEN
      UPDATE patients
         SET whatsapp_opt_in_at=coalesce(whatsapp_opt_in_at, NEW.created_at)
       WHERE id=NEW.patient_id AND tenant_id=NEW.tenant_id;
    ELSE
      UPDATE patients SET whatsapp_opt_in_at=NULL
       WHERE id=NEW.patient_id AND tenant_id=NEW.tenant_id;
      UPDATE outbound_messages SET status='cancelled', updated_at=now()
       WHERE patient_id=NEW.patient_id AND tenant_id=NEW.tenant_id
         AND channel='whatsapp' AND status IN ('pending','failed','uncertain');
    END IF;
  END IF;
  RETURN NEW;
END $$;
