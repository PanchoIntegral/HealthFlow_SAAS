-- Extensiones
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── tenants (clínicas) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_clinica text NOT NULL,
  rfc            text,
  plan           text NOT NULL DEFAULT 'free',
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ── users (médicos / asistentes / admin) ─────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email              text NOT NULL,
  password_hash      text NOT NULL,
  nombre             text NOT NULL,
  rol                text NOT NULL CHECK (rol IN ('medico', 'asistente', 'admin')),
  cedula_profesional text,
  especialidad       text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

-- ── patients ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patients (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre           text NOT NULL,
  fecha_nacimiento date NOT NULL,
  curp             text,
  telefono         text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patients_tenant_idx ON patients(tenant_id);

-- ── appointments ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id        uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id         uuid NOT NULL REFERENCES users(id),
  motivo            text,
  inicio_programado timestamptz NOT NULL,
  fin_programado    timestamptz NOT NULL,
  estatus           text NOT NULL DEFAULT 'agendada'
                    CHECK (estatus IN ('agendada','en_espera','en_consulta','finalizada','cancelada','no_asistio')),
  checkin_at        timestamptz,
  inicio_real       timestamptz,
  fin_real          timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS appointments_tenant_idx ON appointments(tenant_id);
CREATE INDEX IF NOT EXISTS appointments_tenant_estatus_idx ON appointments(tenant_id, estatus);

-- ── audit_log ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES users(id),
  entidad    text NOT NULL,
  entidad_id uuid,
  accion     text NOT NULL,
  detalle    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_tenant_idx ON audit_log(tenant_id);
