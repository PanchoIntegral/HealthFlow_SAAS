-- ═══════════════════════════════════════════════════════════════════
-- Radiografías (y en general, imágenes clínicas).
--
-- El archivo en sí NO vive en Postgres: `storage_key` apunta a un objeto en
-- almacenamiento S3-compatible (R2 en producción). Esta tabla es solo la
-- metadata — quién subió qué, cuándo, y dónde encontrarlo. El acceso al
-- archivo real pasa siempre por una URL prefirmada de vida corta (ver
-- apps/api/src/modules/radiografias/), nunca por una URL pública fija.
--
-- A diferencia de `consentimientos` (0015), SÍ se permite DELETE: subir la
-- imagen equivocada es un error operativo mundano (foto movida, paciente
-- equivocado), no un documento médico-legal que deba preservarse para
-- siempre. Por eso aquí no hay REVOKE de UPDATE/DELETE.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS radiografias (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id     uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  -- Opcional: solo se llena si en el futuro se captura desde una consulta en
  -- curso. Hoy la única vía de alta es el expediente del paciente.
  appointment_id uuid REFERENCES appointments(id),
  storage_key    text NOT NULL,
  mime_type      text NOT NULL,
  subido_por     uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS radiografias_tenant_idx ON radiografias(tenant_id);
CREATE INDEX IF NOT EXISTS radiografias_patient_idx ON radiografias(patient_id);
CREATE INDEX IF NOT EXISTS radiografias_appointment_idx
  ON radiografias(appointment_id) WHERE appointment_id IS NOT NULL;

ALTER TABLE radiografias ENABLE ROW LEVEL SECURITY;
ALTER TABLE radiografias FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON radiografias
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON radiografias TO healthflow_app;
