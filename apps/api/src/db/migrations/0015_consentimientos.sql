-- ═══════════════════════════════════════════════════════════════════
-- Consentimiento informado.
--
-- Registro de que el procedimiento, sus riesgos y alternativas fueron
-- explicados al paciente antes de un procedimiento invasivo. NO captura firma
-- del paciente (decisión del negocio): es el médico quien documenta, en un
-- solo paso, que la explicación se dio.
--
-- Sin estatus ni máquina de estados: se crea ya completo e inmutable. El
-- GRANT de abajo, a propósito, NO incluye UPDATE ni DELETE — a diferencia de
-- `presupuestos` (que sí los otorga aunque nunca actualiza tras aceptar), acá
-- no hay ningún caso de uso legítimo de editar o borrar un consentimiento ya
-- creado. Si algo necesita corregirse, se crea uno nuevo y el anterior queda
-- como historial — igual que una nota clínica cerrada.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS consentimientos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id     uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  -- Vínculo opcional al plan de tratamiento presupuestado. Sin ON DELETE: si
  -- el presupuesto se borra (no ocurre hoy en la app, pero por si acaso), el
  -- consentimiento debe sobrevivir como registro médico-legal independiente.
  presupuesto_id uuid REFERENCES presupuestos(id),
  doctor_id      uuid NOT NULL REFERENCES users(id),
  procedimiento  text NOT NULL,
  -- Riesgos, alternativas e indicaciones explicadas al paciente.
  contenido      text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS consentimientos_tenant_idx ON consentimientos(tenant_id);
CREATE INDEX IF NOT EXISTS consentimientos_patient_idx ON consentimientos(patient_id);
CREATE INDEX IF NOT EXISTS consentimientos_presupuesto_idx
  ON consentimientos(presupuesto_id) WHERE presupuesto_id IS NOT NULL;

ALTER TABLE consentimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE consentimientos FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON consentimientos
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- Sin UPDATE ni DELETE: inmutabilidad reforzada a nivel de base, no solo por
-- ausencia de endpoint en la API. OJO: 0001_rls.sql fija
-- `ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE, DELETE` para
-- toda tabla nueva, así que un GRANT explícito no basta — hace falta el
-- REVOKE para de verdad quitarle esos dos permisos al rol de la app.
GRANT SELECT, INSERT ON consentimientos TO healthflow_app;
REVOKE UPDATE, DELETE ON consentimientos FROM healthflow_app;
