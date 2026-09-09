-- Reserva pública y mensajería transaccional. La migración es deliberadamente
-- autocontenida: la API sigue sin poder atravesar RLS y los únicos accesos
-- públicos/cross-tenant son funciones SECURITY DEFINER de superficie mínima.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS telefono_normalizado text,
  ADD COLUMN IF NOT EXISTS canal_preferido text NOT NULL DEFAULT 'whatsapp'
    CHECK (canal_preferido IN ('whatsapp','email','ninguno')),
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS aviso_privacidad_version text,
  ADD COLUMN IF NOT EXISTS aviso_privacidad_aceptado_at timestamptz,
  ADD COLUMN IF NOT EXISTS posible_duplicado boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS patients_public_match_idx
  ON patients (tenant_id, lower(nombre), fecha_nacimiento, telefono_normalizado)
  WHERE archivado_en IS NULL;

CREATE TABLE booking_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE
    DEFAULT current_tenant_id(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  publicado boolean NOT NULL DEFAULT false,
  timezone text NOT NULL DEFAULT 'America/Mexico_City',
  anticipacion_minima_horas int NOT NULL DEFAULT 4 CHECK (anticipacion_minima_horas BETWEEN 0 AND 720),
  horizonte_dias int NOT NULL DEFAULT 60 CHECK (horizonte_dias BETWEEN 1 AND 365),
  limite_cancelacion_horas int NOT NULL DEFAULT 4 CHECK (limite_cancelacion_horas BETWEEN 0 AND 720),
  recordatorios_horas int[] NOT NULL DEFAULT ARRAY[48,24],
  feature_activa boolean NOT NULL DEFAULT false,
  aviso_privacidad_version text NOT NULL DEFAULT '2026-01',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (array_length(recordatorios_horas, 1) IS NULL OR
         0 < ALL(recordatorios_horas))
);

CREATE TABLE booking_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE DEFAULT current_tenant_id(),
  nombre text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 2 AND 100),
  duracion_minutos int NOT NULL CHECK (duracion_minutos BETWEEN 10 AND 480),
  precio_centavos int CHECK (precio_centavos IS NULL OR precio_centavos >= 0),
  publico boolean NOT NULL DEFAULT true,
  activo boolean NOT NULL DEFAULT true,
  orden int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_services_tenant_idx ON booking_services(tenant_id, orden, nombre);

CREATE TABLE booking_service_doctors (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE DEFAULT current_tenant_id(),
  service_id uuid NOT NULL REFERENCES booking_services(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (service_id, doctor_id)
);

CREATE TABLE doctor_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE DEFAULT current_tenant_id(),
  doctor_id uuid NOT NULL REFERENCES users(id),
  weekday int NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  inicio_local time NOT NULL,
  fin_local time NOT NULL,
  CHECK (fin_local > inicio_local),
  UNIQUE (doctor_id, weekday, inicio_local, fin_local)
);

CREATE TABLE availability_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE DEFAULT current_tenant_id(),
  doctor_id uuid NOT NULL REFERENCES users(id),
  fecha date NOT NULL,
  inicio_local time,
  fin_local time,
  disponible boolean NOT NULL DEFAULT false,
  nota text,
  CHECK ((inicio_local IS NULL AND fin_local IS NULL) OR
         (inicio_local IS NOT NULL AND fin_local IS NOT NULL AND fin_local > inicio_local))
);
CREATE INDEX availability_exceptions_lookup_idx
  ON availability_exceptions(tenant_id, doctor_id, fecha);

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS service_id uuid REFERENCES booking_services(id),
  ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'interno'
    CHECK (origen IN ('interno','publico')),
  ADD COLUMN IF NOT EXISTS estado_confirmacion text NOT NULL DEFAULT 'pendiente'
    CHECK (estado_confirmacion IN ('pendiente','confirmada','cancelada')),
  ADD COLUMN IF NOT EXISTS public_manage_token_hash text,
  ADD COLUMN IF NOT EXISTS manage_token_expires_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS appointments_manage_token_hash_idx
  ON appointments(public_manage_token_hash) WHERE public_manage_token_hash IS NOT NULL;

-- No reescribimos citas históricas que ya estén traslapadas. Las marcamos
-- fuera del índice una sola vez; todo INSERT o cambio de horario nuevo entra
-- con guard=true. El trigger serializa por tenant+médico y compara también
-- contra el legado, de modo que tampoco se puede reservar encima de él.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS scheduling_guard boolean;
UPDATE appointments SET scheduling_guard=false WHERE scheduling_guard IS NULL;
ALTER TABLE appointments ALTER COLUMN scheduling_guard SET DEFAULT true;
ALTER TABLE appointments ALTER COLUMN scheduling_guard SET NOT NULL;
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_no_doctor_overlap;
ALTER TABLE appointments ADD CONSTRAINT appointments_no_doctor_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    doctor_id WITH =,
    tstzrange(inicio_programado, fin_programado, '[)') WITH &&
  ) WHERE (scheduling_guard AND estatus NOT IN ('cancelada','no_asistio'));

CREATE OR REPLACE FUNCTION prevent_appointment_overlap() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
  IF NEW.estatus IN ('cancelada','no_asistio') THEN RETURN NEW; END IF;
  -- El advisory lock elimina la ventana entre SELECT y escritura incluso si
  -- los dos requests aterrizan en procesos distintos.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||NEW.doctor_id::text,0));
  IF EXISTS (
    SELECT 1 FROM appointments a WHERE a.tenant_id=NEW.tenant_id
      AND a.doctor_id=NEW.doctor_id AND a.id<>NEW.id
      AND a.estatus NOT IN ('cancelada','no_asistio')
      AND tstzrange(a.inicio_programado,a.fin_programado,'[)') &&
          tstzrange(NEW.inicio_programado,NEW.fin_programado,'[)')
  ) THEN RAISE EXCEPTION 'doctor schedule overlap' USING ERRCODE='23P01'; END IF;
  NEW.scheduling_guard := true;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS appointments_overlap_guard ON appointments;
CREATE TRIGGER appointments_overlap_guard BEFORE INSERT OR UPDATE OF
  doctor_id,inicio_programado,fin_programado,estatus ON appointments
  FOR EACH ROW EXECUTE FUNCTION prevent_appointment_overlap();

CREATE TABLE outbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE DEFAULT current_tenant_id(),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id),
  channel text NOT NULL CHECK (channel IN ('whatsapp','email')),
  kind text NOT NULL CHECK (kind IN ('confirmation','reminder','rescheduled','cancelled')),
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','sent','delivered','failed','dead','cancelled','bounced','complained')),
  provider text NOT NULL,
  provider_message_id text,
  idempotency_key text NOT NULL UNIQUE,
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  locked_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbound_messages_due_idx
  ON outbound_messages(next_attempt_at, scheduled_at)
  WHERE status IN ('pending','failed','processing');
CREATE UNIQUE INDEX outbound_messages_provider_id_idx
  ON outbound_messages(provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE TABLE messaging_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE DEFAULT current_tenant_id(),
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  message_id uuid REFERENCES outbound_messages(id) ON DELETE SET NULL,
  event text NOT NULL CHECK (event IN
    ('scheduled','sent','delivered','failed','confirmed','rescheduled','cancelled','bounced','complained')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messaging_events_metrics_idx ON messaging_events(tenant_id, created_at, event);

CREATE TABLE messaging_webhook_events (
  provider text NOT NULL,
  external_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  PRIMARY KEY(provider, external_id)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'booking_settings','booking_services','booking_service_doctors',
    'doctor_availability','availability_exceptions','outbound_messages','messaging_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  booking_settings, booking_services, booking_service_doctors,
  doctor_availability, availability_exceptions, outbound_messages,
  messaging_events, messaging_webhook_events TO healthflow_app;

-- Solo revela el UUID opaco del tenant después de comprobar publicación,
-- feature flag, plan y estado de cobro. No expone pacientes ni configuración.
CREATE OR REPLACE FUNCTION resolve_public_booking_tenant(p_slug text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT bs.tenant_id
    FROM booking_settings bs JOIN tenants t ON t.id = bs.tenant_id
   WHERE bs.slug = lower(p_slug) AND bs.publicado AND bs.feature_activa
     AND t.plan IN ('consultorio','clinica','pro')
     AND (t.subscription_status IN ('active','trialing') OR
          (t.subscription_status = 'past_due' AND t.grace_until > now()) OR
          (t.subscription_status = 'none' AND current_setting('app.allow_unpaid_public_booking', true) = 'on'))
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION resolve_public_appointment_tenant(p_token_hash text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.tenant_id FROM appointments a
   WHERE a.public_manage_token_hash = p_token_hash
     AND a.manage_token_expires_at > now()
   LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION resolve_public_booking_tenant(text) TO healthflow_app;
GRANT EXECUTE ON FUNCTION resolve_public_appointment_tenant(text) TO healthflow_app;

-- Claim atómico: SKIP LOCKED permite muchos workers sin mensajes duplicados.
CREATE OR REPLACE FUNCTION claim_outbound_messages(p_limit int DEFAULT 20)
RETURNS TABLE (
  id uuid, tenant_id uuid, channel text, kind text, clinic_name text,
  destination text, appointment_id uuid, starts_at timestamptz, attempts int
) LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  WITH due AS (
    SELECT om.id FROM outbound_messages om
     WHERE ((om.status IN ('pending','failed') AND om.next_attempt_at <= now()) OR
            (om.status = 'processing' AND om.locked_at < now() - interval '10 minutes'))
       AND om.scheduled_at <= now()
     ORDER BY om.next_attempt_at, om.created_at
     FOR UPDATE SKIP LOCKED LIMIT greatest(1, least(p_limit, 100))
  ), claimed AS (
    UPDATE outbound_messages om SET status='processing', locked_at=now(),
      attempts=om.attempts + 1, updated_at=now()
      FROM due WHERE om.id=due.id
    RETURNING om.*
  )
  SELECT c.id, c.tenant_id, c.channel, c.kind, t.nombre_clinica,
         CASE WHEN c.channel='whatsapp' THEN p.telefono_normalizado ELSE p.email END,
         c.appointment_id, a.inicio_programado, c.attempts
    FROM claimed c JOIN tenants t ON t.id=c.tenant_id
    JOIN patients p ON p.id=c.patient_id JOIN appointments a ON a.id=c.appointment_id
$$;

CREATE OR REPLACE FUNCTION complete_outbound_message(
  p_id uuid, p_ok boolean, p_provider_id text DEFAULT NULL, p_error_code text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_attempts int; v_tenant uuid; v_appointment uuid; BEGIN
  SELECT attempts, tenant_id, appointment_id INTO v_attempts, v_tenant, v_appointment
    FROM outbound_messages WHERE id=p_id AND status='processing' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF p_ok THEN
    UPDATE outbound_messages SET status='sent', provider_message_id=p_provider_id,
      locked_at=NULL, last_error_code=NULL, updated_at=now() WHERE id=p_id;
    INSERT INTO messaging_events(tenant_id,appointment_id,message_id,event)
      VALUES(v_tenant,v_appointment,p_id,'sent');
  ELSE
    UPDATE outbound_messages SET status=CASE WHEN v_attempts >= 5 THEN 'dead' ELSE 'failed' END,
      next_attempt_at=now() + make_interval(mins => least(60, power(2, v_attempts)::int)),
      locked_at=NULL, last_error_code=left(coalesce(p_error_code,'provider_error'),80), updated_at=now()
      WHERE id=p_id;
    INSERT INTO messaging_events(tenant_id,appointment_id,message_id,event)
      VALUES(v_tenant,v_appointment,p_id,'failed');
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION claim_outbound_messages(int) TO healthflow_app;
GRANT EXECUTE ON FUNCTION complete_outbound_message(uuid,boolean,text,text) TO healthflow_app;

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
    UPDATE messaging_webhook_events SET processed_at=now()
      WHERE provider=p_provider AND external_id=p_external_event_id;
    RETURN true;
  END IF;
  v_event := CASE
    WHEN p_status IN ('delivered') THEN 'delivered'
    WHEN p_status IN ('bounced') THEN 'bounced'
    WHEN p_status IN ('complained') THEN 'complained'
    WHEN p_status IN ('failed','undelivered') THEN 'failed'
    ELSE NULL END;
  IF v_event IS NOT NULL THEN
    UPDATE outbound_messages SET status=CASE WHEN p_status='undelivered' THEN 'failed' ELSE p_status END,
      updated_at=now() WHERE id=v_message.id;
    INSERT INTO messaging_events(tenant_id,appointment_id,message_id,event)
      VALUES(v_message.tenant_id,v_message.appointment_id,v_message.id,v_event);
  END IF;
  IF p_status IN ('bounced','complained') AND v_message.channel='email' THEN
    UPDATE outbound_messages SET status='cancelled',updated_at=now()
      WHERE patient_id=v_message.patient_id AND channel='email'
        AND status IN ('pending','failed');
  END IF;
  UPDATE messaging_webhook_events SET processed_at=now()
    WHERE provider=p_provider AND external_id=p_external_event_id;
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION process_messaging_status(text,text,text,text) TO healthflow_app;

-- El rol se crea en db:setup. El bloque condicional mantiene la migración
-- portable en instalaciones donde aún no se ha provisionado el worker.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='healthflow_worker') THEN
    GRANT USAGE ON SCHEMA public TO healthflow_worker;
    GRANT EXECUTE ON FUNCTION claim_outbound_messages(int) TO healthflow_worker;
    GRANT EXECUTE ON FUNCTION complete_outbound_message(uuid,boolean,text,text) TO healthflow_worker;
  END IF;
END $$;
