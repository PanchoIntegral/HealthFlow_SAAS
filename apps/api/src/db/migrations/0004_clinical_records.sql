-- ═══════════════════════════════════════════════════════════════════
-- Expediente clínico (NOM-004-SSA3-2012).
--   clinical_records : expediente permanente, uno por paciente.
--   clinical_notes   : una nota por consulta (ligada a una cita).
--   note_amendments  : correcciones a notas cerradas (nunca se reescribe).
-- Todas con RLS + DEFAULT current_tenant_id() (mismo patrón que patients).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS clinical_records (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL UNIQUE REFERENCES patients(id) ON DELETE CASCADE,
  abierto_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clinical_records_tenant_idx ON clinical_records(tenant_id);

CREATE TABLE IF NOT EXISTS clinical_notes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  clinical_record_id uuid NOT NULL REFERENCES clinical_records(id) ON DELETE CASCADE,
  appointment_id    uuid NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  doctor_id         uuid NOT NULL REFERENCES users(id),
  tipo_nota         text NOT NULL DEFAULT 'nota_evolucion'
                    CHECK (tipo_nota IN ('nota_evolucion','historia_clinica')),
  contenido_nom004  jsonb NOT NULL DEFAULT '{}'::jsonb,
  estatus           text NOT NULL DEFAULT 'borrador'
                    CHECK (estatus IN ('borrador','cerrada')),
  cerrado_en        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clinical_notes_tenant_idx ON clinical_notes(tenant_id);
CREATE INDEX IF NOT EXISTS clinical_notes_record_idx ON clinical_notes(clinical_record_id);

CREATE TABLE IF NOT EXISTS note_amendments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  clinical_note_id uuid NOT NULL REFERENCES clinical_notes(id) ON DELETE CASCADE,
  doctor_id        uuid NOT NULL REFERENCES users(id),
  texto_correccion text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS note_amendments_note_idx ON note_amendments(clinical_note_id);

-- RLS por tenant para las tres tablas (misma política que el resto).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clinical_records','clinical_notes','note_amendments']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t
    );
  END LOOP;
END $$;
