-- P0.1: idempotencia de extremo a extremo.
--
-- 1. `appointments.messaging_version` numera cada "generación" de mensajes de
--    una cita. Se incrementa al reprogramar. Forma parte de la clave de outbox
--    para que reprogramar A -> B -> A no choque con las filas canceladas de la
--    primera A (antes la clave dependía de la fecha de inicio y el
--    `ON CONFLICT DO NOTHING` descartaba en silencio los recordatorios nuevos).
--
-- 2. `claim_outbound_messages()` devuelve `idempotency_key` para que el worker
--    la entregue tal cual al proveedor. Ningún adaptador deriva claves propias.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS messaging_version int NOT NULL DEFAULT 1;

DROP FUNCTION IF EXISTS claim_outbound_messages(int);
CREATE FUNCTION claim_outbound_messages(p_limit int DEFAULT 20)
RETURNS TABLE (
  id uuid, tenant_id uuid, channel text, kind text, clinic_name text,
  clinic_timezone text, destination text, appointment_id uuid,
  starts_at timestamptz, attempts int, idempotency_key text
) LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  WITH due AS (
    SELECT om.id FROM outbound_messages om
     WHERE ((om.status IN ('pending','failed') AND om.next_attempt_at <= now()) OR
            (om.status='processing' AND om.locked_at < now()-interval '10 minutes'))
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
    JOIN patients p ON p.id=c.patient_id JOIN appointments a ON a.id=c.appointment_id
$$;
GRANT EXECUTE ON FUNCTION claim_outbound_messages(int) TO healthflow_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='healthflow_worker') THEN
  GRANT EXECUTE ON FUNCTION claim_outbound_messages(int) TO healthflow_worker;
END IF; END $$;
