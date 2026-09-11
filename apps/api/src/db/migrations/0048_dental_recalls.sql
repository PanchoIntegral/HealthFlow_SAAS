-- Entrega 1: Recall y reactivación.
--
-- Un recall NO es un recordatorio. El recordatorio parte de una cita que ya
-- existe; el recall intenta conseguir una cita nueva a partir de una fecha
-- clínica en la que el paciente debería volver. Por eso vive en sus propias
-- tablas y no como una bandera sobre `appointments`.
--
-- Sólo esquema y permisos. El dominio (máquina de estados) vive en TypeScript
-- y se prueba sin PostgreSQL; aquí quedan las invariantes que ninguna capa de
-- aplicación puede saltarse.

-- ── Tipos de control configurables por clínica ───────────────────
CREATE TABLE recall_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
    DEFAULT current_tenant_id(),
  nombre text NOT NULL CHECK (btrim(nombre) <> '' AND length(nombre) <= 80),
  -- Columna generada: la clínica no puede tener dos "Limpieza" activas que
  -- difieran en mayúsculas o espacios. Sin `unaccent` a propósito — es una
  -- extensión que no está garantizada en todas las instalaciones, y "Revisión"
  -- vs "Revision" es una diferencia que un humano ve.
  nombre_normalizado text GENERATED ALWAYS AS (lower(btrim(nombre))) STORED,
  /** Cada cuánto debe volver el paciente. 1 a 120 meses. */
  interval_months int NOT NULL CHECK (interval_months BETWEEN 1 AND 120),
  /** Servicio de la reserva pública con el que se agenda este control. */
  booking_service_id uuid REFERENCES booking_services(id) ON DELETE SET NULL,
  activo boolean NOT NULL DEFAULT true,
  /** Si al terminar un tratamiento se crea solo el siguiente ciclo. */
  auto_generar boolean NOT NULL DEFAULT false,
  /** Cuántos días ANTES del vencimiento se hace el primer contacto. */
  days_before_first_contact int NOT NULL DEFAULT 0
    CHECK (days_before_first_contact BETWEEN 0 AND 90),
  max_attempts int NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  attempt_spacing_days int NOT NULL DEFAULT 7
    CHECK (attempt_spacing_days BETWEEN 1 AND 180),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Único entre los ACTIVOS: desactivar un tipo y crear otro con el mismo nombre
-- es una operación legítima, y el histórico conserva a cuál pertenecía cada
-- recall.
CREATE UNIQUE INDEX recall_types_nombre_activo_idx
  ON recall_types (tenant_id, nombre_normalizado) WHERE activo;

-- ── El control pendiente de un paciente ──────────────────────────
CREATE TABLE patient_recalls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
    DEFAULT current_tenant_id(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  -- RESTRICT y no CASCADE: un tipo con recalls no se borra, se desactiva.
  -- Perder el historial de controles al limpiar un catálogo sería un daño
  -- silencioso e irreversible.
  recall_type_id uuid NOT NULL REFERENCES recall_types(id) ON DELETE RESTRICT,
  source text NOT NULL
    CHECK (source IN ('manual','procedimiento','periodontograma','reactivacion')),
  /** Partida, examen o cita que lo originó. Sin FK: apunta a varias tablas. */
  source_entity_id uuid,
  /**
   * `date` y no `timestamptz`: "vence en marzo" es un concepto local de la
   * clínica. La conversión usa booking_settings.timezone, igual que el worker
   * de mensajería desde 0038.
   */
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN
    ('pending','due','contacted','scheduled','completed','dismissed','exhausted')),
  assigned_doctor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  /** La cita que cerró el seguimiento. */
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  last_contact_at timestamptz,
  next_attempt_at timestamptz,
  completed_at timestamptz,
  dismiss_reason text CHECK (dismiss_reason IS NULL OR length(dismiss_reason) <= 280),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Invariantes del estado, en SQL y no sólo en el dominio: el worker y
  -- cualquier script futuro escriben por aquí igual que los casos de uso.
  CONSTRAINT patient_recalls_completado_chk
    CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CONSTRAINT patient_recalls_descartado_chk
    CHECK (status = 'dismissed' OR dismiss_reason IS NULL),
  CONSTRAINT patient_recalls_agendado_chk
    CHECK (status <> 'scheduled' OR appointment_id IS NOT NULL)
);

-- LA invariante del módulo: no puede haber dos controles VIVOS del mismo tipo
-- para el mismo paciente. Es la segunda capa de idempotencia — la primera es
-- app_event_consumptions(event_id, consumer), que cubre reprocesar el MISMO
-- evento; ésta cubre dos eventos DISTINTOS que pedirían el mismo recall (dos
-- limpiezas terminadas el mismo día).
CREATE UNIQUE INDEX patient_recalls_vivo_idx
  ON patient_recalls (tenant_id, patient_id, recall_type_id)
  WHERE status IN ('pending','due','contacted','scheduled');

-- Tablero de recepción: filtra por estado y ordena por vencimiento.
CREATE INDEX patient_recalls_worklist_idx
  ON patient_recalls (tenant_id, status, due_date, id);
-- Barrido del worker: pending que ya vencieron, y contactados que toca reintentar.
CREATE INDEX patient_recalls_vencidos_idx
  ON patient_recalls (due_date) WHERE status = 'pending';
CREATE INDEX patient_recalls_proximo_intento_idx
  ON patient_recalls (next_attempt_at) WHERE status IN ('due','contacted');
CREATE INDEX patient_recalls_paciente_idx
  ON patient_recalls (tenant_id, patient_id, created_at DESC);

-- ── Cada gestión de contacto ─────────────────────────────────────
CREATE TABLE recall_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
    DEFAULT current_tenant_id(),
  patient_recall_id uuid NOT NULL REFERENCES patient_recalls(id) ON DELETE CASCADE,
  /**
   * 'phone' y 'manual' son intentos que NO generan mensaje: son una tarea que
   * recepción cierra a mano. Es lo que permite operar el módulo sin Twilio y
   * sin dominio de correo verificado.
   */
  channel text NOT NULL CHECK (channel IN ('email','whatsapp','phone','manual')),
  attempt_number int NOT NULL CHECK (attempt_number BETWEEN 1 AND 10),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','closed','cancelled')),
  scheduled_at timestamptz NOT NULL,
  sent_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  result text CHECK (result IN
    ('sent','answered','booked','declined','unreachable','failed')),
  /** Nota administrativa corta ("no contesta", "pide llamar el lunes"). */
  note text CHECK (note IS NULL OR length(note) <= 280),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT recall_attempts_cerrado_chk
    CHECK (status <> 'closed' OR result IS NOT NULL)
);

-- No dos intentos con el mismo número para el mismo recall. Junto con la
-- clave de idempotencia de outbound_messages, impide que dos workers creen
-- el mismo envío.
CREATE UNIQUE INDEX recall_attempts_numero_idx
  ON recall_attempts (tenant_id, patient_recall_id, attempt_number);
CREATE INDEX recall_attempts_pendientes_idx
  ON recall_attempts (scheduled_at) WHERE status = 'pending';

-- ── Coherencia de tenant en las referencias cruzadas ─────────────
-- Las comprobaciones de llave foránea NO pasan por RLS: sin esto, una fila
-- podría apuntar al paciente de otra clínica y la FK lo aceptaría.
CREATE OR REPLACE FUNCTION check_recall_tenant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'recall_types' THEN
    IF NEW.booking_service_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM booking_services
       WHERE id = NEW.booking_service_id AND tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'booking service does not belong to recall tenant' USING ERRCODE='23503';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'patient_recalls' THEN
    IF NOT EXISTS (SELECT 1 FROM patients WHERE id = NEW.patient_id AND tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'patient does not belong to recall tenant' USING ERRCODE='23503';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM recall_types WHERE id = NEW.recall_type_id AND tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'recall type does not belong to recall tenant' USING ERRCODE='23503';
    END IF;
    IF NEW.assigned_doctor_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM users WHERE id = NEW.assigned_doctor_id AND tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'doctor does not belong to recall tenant' USING ERRCODE='23503';
    END IF;
    IF NEW.appointment_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM appointments WHERE id = NEW.appointment_id AND tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'appointment does not belong to recall tenant' USING ERRCODE='23503';
    END IF;
    RETURN NEW;
  END IF;

  -- recall_attempts
  IF NOT EXISTS (
    SELECT 1 FROM patient_recalls WHERE id = NEW.patient_recall_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'recall does not belong to attempt tenant' USING ERRCODE='23503';
  END IF;
  IF NEW.created_by IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.created_by AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'actor does not belong to attempt tenant' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER recall_types_tenant BEFORE INSERT OR UPDATE ON recall_types
  FOR EACH ROW EXECUTE FUNCTION check_recall_tenant();
CREATE TRIGGER patient_recalls_tenant BEFORE INSERT OR UPDATE ON patient_recalls
  FOR EACH ROW EXECUTE FUNCTION check_recall_tenant();
CREATE TRIGGER recall_attempts_tenant BEFORE INSERT OR UPDATE ON recall_attempts
  FOR EACH ROW EXECUTE FUNCTION check_recall_tenant();

-- ── RLS y permisos ───────────────────────────────────────────────
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['recall_types','patient_recalls','recall_attempts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON recall_types, patient_recalls, recall_attempts
  TO healthflow_app;
-- Nada se borra: un tipo se desactiva, un recall se descarta y un intento se
-- cancela. El REVOKE es imprescindible porque 0001_rls concede ALL sobre el
-- esquema y una tabla nueva nace con esos permisos.
REVOKE DELETE ON recall_types, patient_recalls, recall_attempts FROM healthflow_app;

-- El worker NO tenía ningún permiso de tabla: reclamaba y cerraba eventos por
-- funciones SECURITY DEFINER, pero el manejador de un consumidor real habría
-- fallado en su primera lectura de negocio. Recall es el primer módulo con
-- consumidores, así que le toca concederlos.
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='healthflow_worker') THEN
  GRANT SELECT, INSERT, UPDATE ON patient_recalls, recall_attempts TO healthflow_worker;
  GRANT SELECT ON recall_types, patients, appointments, tenants, booking_settings
    TO healthflow_worker;
END IF; END $$;
