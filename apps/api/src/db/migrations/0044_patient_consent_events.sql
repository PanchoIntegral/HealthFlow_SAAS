-- P0.5 / P0.6: el consentimiento de WhatsApp es un historial, no una casilla.
--
-- Cada otorgamiento o retiro es un evento inmutable con versión del aviso,
-- origen y actor. `patients.whatsapp_opt_in_at` se conserva como la única
-- columna derivada (el worker y las consultas actuales la leen) y la mantiene
-- un trigger a partir del último evento. Un retiro
-- cancela en el acto los WhatsApp pendientes del paciente.

CREATE TABLE patient_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE DEFAULT current_tenant_id(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('whatsapp')),
  accion text NOT NULL CHECK (accion IN ('otorgado','retirado')),
  version_aviso text,
  origen text NOT NULL CHECK (origen IN ('reserva_publica','recepcion','paciente','importacion','migracion')),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patient_consent_events_patient_idx ON patient_consent_events(tenant_id, patient_id, created_at DESC);

ALTER TABLE patient_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_consent_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON patient_consent_events
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
-- Inmutable: sin UPDATE ni DELETE para la aplicación.
GRANT SELECT, INSERT ON patient_consent_events TO healthflow_app;

CREATE OR REPLACE FUNCTION apply_patient_consent_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  -- La FK simple sólo prueba que el paciente existe. Esta comprobación es
  -- indispensable porque la función corre como SECURITY DEFINER y por tanto
  -- no puede confiar únicamente en RLS.
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
CREATE TRIGGER patient_consent_events_apply AFTER INSERT ON patient_consent_events
  FOR EACH ROW EXECUTE FUNCTION apply_patient_consent_event();

-- Historial inicial: quien ya tenía opt-in conserva evidencia de cuándo se otorgó.
INSERT INTO patient_consent_events(tenant_id, patient_id, tipo, accion, version_aviso, origen, created_at)
SELECT tenant_id, id, 'whatsapp', 'otorgado', aviso_privacidad_version, 'migracion', whatsapp_opt_in_at
  FROM patients WHERE whatsapp_opt_in_at IS NOT NULL;
