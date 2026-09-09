CREATE OR REPLACE FUNCTION process_messaging_status(
  p_provider text, p_external_event_id text, p_provider_message_id text, p_status text
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_message outbound_messages%ROWTYPE; v_event text; BEGIN
  INSERT INTO messaging_webhook_events(provider,external_id)
    VALUES(p_provider,p_external_event_id) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO v_message FROM outbound_messages
    WHERE provider=p_provider AND provider_message_id=p_provider_message_id FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE messaging_webhook_events SET processed_at=now() WHERE provider=p_provider AND external_id=p_external_event_id;
    RETURN true;
  END IF;
  v_event := CASE WHEN p_status='delivered' THEN 'delivered'
    WHEN p_status='bounced' THEN 'bounced' WHEN p_status='complained' THEN 'complained'
    WHEN p_status IN ('failed','undelivered') THEN 'failed' ELSE NULL END;
  IF v_event IS NOT NULL THEN
    UPDATE outbound_messages SET
      status=CASE WHEN p_status IN ('failed','undelivered') THEN CASE WHEN attempts>=5 THEN 'dead' ELSE 'failed' END ELSE p_status END,
      next_attempt_at=CASE WHEN p_status IN ('failed','undelivered') THEN now()+make_interval(mins=>least(60,power(2,attempts)::int)) ELSE next_attempt_at END,
      last_error_code=CASE WHEN p_status IN ('failed','undelivered') THEN left(p_status,80) ELSE last_error_code END,
      updated_at=now() WHERE id=v_message.id;
    INSERT INTO messaging_events(tenant_id,appointment_id,message_id,event)
      VALUES(v_message.tenant_id,v_message.appointment_id,v_message.id,v_event);
  END IF;
  IF p_status IN ('bounced','complained') AND v_message.channel='email' THEN
    UPDATE patients SET email_suppressed_at=now() WHERE id=v_message.patient_id;
    UPDATE outbound_messages SET status='cancelled',updated_at=now()
      WHERE patient_id=v_message.patient_id AND channel='email' AND status IN ('pending','failed');
  END IF;
  UPDATE messaging_webhook_events SET processed_at=now() WHERE provider=p_provider AND external_id=p_external_event_id;
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION process_messaging_status(text,text,text,text) TO healthflow_app;
