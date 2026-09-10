-- P0.2: entregas ambiguas y carreras de webhooks.
--
-- Semántica elegida: at-most-once hacia el paciente. Un mensaje perdido es
-- visible y corregible por la clínica; un duplicado no. Por eso:
--
--  * Nuevo estado `uncertain`: el proveedor pudo haber aceptado el mensaje
--    pero no lo sabemos (timeout, conexión cortada, worker caído después de
--    enviar). Nunca se reintenta solo; lo decide un administrador.
--  * Un lock de `processing` vencido ya no se vuelve a reclamar: pasa a
--    `uncertain` con `lock_expired`.
--  * `complete_outbound_message()` recibe el resultado clasificado
--    (accepted | retryable | permanent | uncertain) en lugar de un booleano.
--  * `messaging_webhook_events` guarda lo mínimo para reprocesar: id del
--    mensaje en el proveedor, estado y un payload saneado (sin destino ni
--    cuerpo). Un webhook que llega antes que el `provider_message_id` queda
--    `pending` y se aplica cuando el worker termina.
--  * Un webhook `undelivered`/`failed` deja de reprogramar reintentos a
--    ciegas: sólo los códigos transitorios conocidos vuelven a `failed`.

-- ── Estados ──────────────────────────────────────────────────────────────
ALTER TABLE outbound_messages DROP CONSTRAINT outbound_messages_status_check;
ALTER TABLE outbound_messages ADD CONSTRAINT outbound_messages_status_check
  CHECK (status IN ('pending','processing','sent','delivered','failed','dead','cancelled','bounced','complained','uncertain'));

ALTER TABLE messaging_events DROP CONSTRAINT messaging_events_event_check;
ALTER TABLE messaging_events ADD CONSTRAINT messaging_events_event_check
  CHECK (event IN ('scheduled','sent','delivered','failed','confirmed','rescheduled','cancelled','bounced','complained','uncertain','resolved'));

-- ── Webhooks reprocesables ───────────────────────────────────────────────
ALTER TABLE messaging_webhook_events
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS payload jsonb,
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'processed'
    CHECK (state IN ('pending','processed','ignored'));
CREATE INDEX IF NOT EXISTS messaging_webhook_events_pending_idx
  ON messaging_webhook_events(provider, provider_message_id, received_at)
  WHERE state='pending';

-- ── Reclamo: sin reenvío de locks vencidos ───────────────────────────────
DROP FUNCTION IF EXISTS claim_outbound_messages(int);
CREATE FUNCTION claim_outbound_messages(p_limit int DEFAULT 20)
RETURNS TABLE (
  id uuid, tenant_id uuid, channel text, kind text, clinic_name text,
  clinic_timezone text, destination text, appointment_id uuid,
  starts_at timestamptz, attempts int, idempotency_key text
) LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Un worker que murió con el mensaje en vuelo no puede saber si el
  -- proveedor lo aceptó. Marcarlo incierto evita el duplicado.
  WITH expired AS (
    UPDATE outbound_messages om SET status='uncertain', locked_at=NULL,
      last_error_code='lock_expired', updated_at=now()
     WHERE om.status='processing' AND om.locked_at < now()-interval '10 minutes'
    RETURNING om.tenant_id, om.appointment_id, om.id
  )
  INSERT INTO messaging_events(tenant_id,appointment_id,message_id,event)
  SELECT e.tenant_id, e.appointment_id, e.id, 'uncertain' FROM expired e;

  RETURN QUERY
  WITH due AS (
    SELECT om.id FROM outbound_messages om
     WHERE om.status IN ('pending','failed') AND om.next_attempt_at <= now()
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

-- ── Aplicación de un webhook ya registrado ───────────────────────────────
-- Devuelve true si encontró el mensaje y aplicó (o ignoró) el evento; false
-- si el mensaje todavía no existe y el evento debe seguir `pending`.
CREATE OR REPLACE FUNCTION apply_messaging_webhook(p_provider text, p_external_event_id text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_hook messaging_webhook_events%ROWTYPE; v_message outbound_messages%ROWTYPE;
        v_event text; v_status text; v_code text; v_retryable boolean; BEGIN
  SELECT * INTO v_hook FROM messaging_webhook_events
    WHERE provider=p_provider AND external_id=p_external_event_id AND state='pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN true; END IF;

  SELECT * INTO v_message FROM outbound_messages
    WHERE provider=v_hook.provider AND provider_message_id=v_hook.provider_message_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  v_status := v_hook.status;
  v_code := v_hook.payload->>'errorCode';
  v_event := CASE WHEN v_status='delivered' THEN 'delivered'
    WHEN v_status='bounced' THEN 'bounced' WHEN v_status='complained' THEN 'complained'
    WHEN v_status IN ('failed','undelivered') THEN 'failed' ELSE NULL END;

  IF v_event IS NULL THEN
    -- queued/sent/read/delivery_delayed...: informativos, sin efecto de estado.
    UPDATE messaging_webhook_events SET state='ignored', processed_at=now()
      WHERE provider=v_hook.provider AND external_id=v_hook.external_id;
    RETURN true;
  END IF;

  IF v_event='failed' THEN
    -- Sólo códigos transitorios conocidos justifican otro intento. Twilio:
    -- 30001 cola llena, 30022 tasa excedida, 63017/63018 límite de tasa.
    -- Resend no reporta fallos reintentables por webhook.
    v_retryable := v_hook.provider='twilio' AND v_code IN ('30001','30022','63017','63018');
    -- Un mensaje ya cerrado (cancelled/dead/delivered) no se reabre por un
    -- webhook tardío o fuera de orden.
    IF v_message.status IN ('sent','processing','uncertain','failed') THEN
      UPDATE outbound_messages SET
        status=CASE WHEN v_retryable AND attempts<5 THEN 'failed' ELSE 'dead' END,
        next_attempt_at=CASE WHEN v_retryable THEN now()+make_interval(mins=>least(60,power(2,attempts)::int)) ELSE next_attempt_at END,
        last_error_code=left(coalesce(v_code,v_status),80), locked_at=NULL, updated_at=now()
        WHERE id=v_message.id;
    END IF;
  ELSIF v_message.status IN ('sent','processing','uncertain','failed') THEN
    UPDATE outbound_messages SET status=v_status, locked_at=NULL, updated_at=now() WHERE id=v_message.id;
  END IF;

  INSERT INTO messaging_events(tenant_id,appointment_id,message_id,event)
    VALUES(v_message.tenant_id,v_message.appointment_id,v_message.id,v_event);

  IF v_status IN ('bounced','complained') AND v_message.channel='email' THEN
    UPDATE patients SET email_suppressed_at=coalesce(email_suppressed_at,now()) WHERE id=v_message.patient_id;
    UPDATE outbound_messages SET status='cancelled',updated_at=now()
      WHERE patient_id=v_message.patient_id AND channel='email' AND status IN ('pending','failed','uncertain');
  END IF;

  UPDATE messaging_webhook_events SET state='processed', processed_at=now()
    WHERE provider=v_hook.provider AND external_id=v_hook.external_id;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION reprocess_pending_webhooks(p_provider text, p_provider_message_id text)
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id text; v_count int := 0; BEGIN
  FOR v_id IN SELECT external_id FROM messaging_webhook_events
    WHERE provider=p_provider AND provider_message_id=p_provider_message_id AND state='pending'
    ORDER BY received_at LOOP
    IF apply_messaging_webhook(p_provider, v_id) THEN v_count := v_count + 1; END IF;
  END LOOP;
  RETURN v_count;
END $$;

-- ── Registro de webhook: dedupe + pending ────────────────────────────────
DROP FUNCTION IF EXISTS process_messaging_status(text,text,text,text);
CREATE FUNCTION process_messaging_status(
  p_provider text, p_external_event_id text, p_provider_message_id text, p_status text, p_payload jsonb DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO messaging_webhook_events(provider,external_id,provider_message_id,status,payload,state)
    VALUES(p_provider,p_external_event_id,p_provider_message_id,p_status,p_payload,'pending')
    ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN false; END IF;   -- repetido: un solo efecto
  PERFORM apply_messaging_webhook(p_provider, p_external_event_id);
  RETURN true;
END $$;

-- ── Cierre de un intento con resultado clasificado ───────────────────────
DROP FUNCTION IF EXISTS complete_outbound_message(uuid,boolean,text,text);
CREATE FUNCTION complete_outbound_message(
  p_id uuid, p_outcome text, p_provider_id text DEFAULT NULL, p_error_code text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_msg outbound_messages%ROWTYPE; BEGIN
  IF p_outcome NOT IN ('accepted','retryable','permanent','uncertain') THEN
    RAISE EXCEPTION 'outcome inválido: %', p_outcome;
  END IF;
  SELECT * INTO v_msg FROM outbound_messages WHERE id=p_id AND status='processing' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF p_outcome='accepted' THEN
    UPDATE outbound_messages SET status='sent', provider_message_id=p_provider_id,
      locked_at=NULL, last_error_code=NULL, updated_at=now() WHERE id=p_id;
    INSERT INTO messaging_events(tenant_id,appointment_id,message_id,event)
      VALUES(v_msg.tenant_id,v_msg.appointment_id,p_id,'sent');
    -- Un webhook pudo adelantarse a esta escritura.
    PERFORM reprocess_pending_webhooks(v_msg.provider, p_provider_id);
  ELSIF p_outcome='retryable' THEN
    UPDATE outbound_messages SET status=CASE WHEN v_msg.attempts >= 5 THEN 'dead' ELSE 'failed' END,
      next_attempt_at=now() + make_interval(mins => least(60, power(2, v_msg.attempts)::int)),
      locked_at=NULL, last_error_code=left(coalesce(p_error_code,'provider_error'),80), updated_at=now()
      WHERE id=p_id;
    INSERT INTO messaging_events(tenant_id,appointment_id,message_id,event)
      VALUES(v_msg.tenant_id,v_msg.appointment_id,p_id,'failed');
  ELSIF p_outcome='permanent' THEN
    UPDATE outbound_messages SET status='dead', locked_at=NULL,
      last_error_code=left(coalesce(p_error_code,'provider_rejected'),80), updated_at=now() WHERE id=p_id;
    INSERT INTO messaging_events(tenant_id,appointment_id,message_id,event)
      VALUES(v_msg.tenant_id,v_msg.appointment_id,p_id,'failed');
  ELSE
    UPDATE outbound_messages SET status='uncertain', locked_at=NULL,
      last_error_code=left(coalesce(p_error_code,'provider_uncertain'),80), updated_at=now() WHERE id=p_id;
    INSERT INTO messaging_events(tenant_id,appointment_id,message_id,event)
      VALUES(v_msg.tenant_id,v_msg.appointment_id,p_id,'uncertain');
  END IF;
END $$;

-- ── Permisos ─────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION claim_outbound_messages(int) TO healthflow_app;
GRANT EXECUTE ON FUNCTION complete_outbound_message(uuid,text,text,text) TO healthflow_app;
GRANT EXECUTE ON FUNCTION process_messaging_status(text,text,text,text,jsonb) TO healthflow_app;
GRANT EXECUTE ON FUNCTION apply_messaging_webhook(text,text) TO healthflow_app;
GRANT EXECUTE ON FUNCTION reprocess_pending_webhooks(text,text) TO healthflow_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='healthflow_worker') THEN
  GRANT EXECUTE ON FUNCTION claim_outbound_messages(int) TO healthflow_worker;
  GRANT EXECUTE ON FUNCTION complete_outbound_message(uuid,text,text,text) TO healthflow_worker;
END IF; END $$;
