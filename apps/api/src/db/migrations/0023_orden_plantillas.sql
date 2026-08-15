-- ═══════════════════════════════════════════════════════════════════
-- Orden de plantillas ortopédicas al laboratorio.
--
-- Es el pedido que el podólogo llena para mandar fabricar la órtesis de un
-- paciente (formato del laboratorio "Microrthopedic Solutions"). Vive en su
-- PROPIA tabla, fuera de clinical_notes, a propósito: una nota firmada es
-- inmutable por NOM-004, pero esta orden no lo es — el laboratorio puede pedir
-- corregir una medida días después de que la consulta ya se cerró, y no hay
-- forma de reabrir una nota firmada para eso. Es un documento hermano de
-- `presupuestos` y `radiografias`: cuelga del paciente (y opcionalmente de la
-- cita que lo originó), con su propio ciclo de vida.
--
-- El catálogo de ~120 casillas y valores del formato vive como DATOS en
-- shared-types (OPCIONES_PLANTILLA / VALORES_PLANTILLA), no como columnas: si
-- el laboratorio cambia su hoja de pedido, se edita esa lista y no hay nada
-- que migrar aquí. `contenido` guarda exactamente lo que esa lista describe.
--
-- SÍ se permite DELETE en el sentido de que no hay REVOKE explícito más abajo:
-- a diferencia de una nota clínica, una orden mal capturada que nunca se
-- envió al laboratorio no es un documento médico-legal que deba preservarse
-- para siempre.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ordenes_plantillas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id     uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id      uuid NOT NULL REFERENCES users(id),
  -- Nullable: hoy toda orden nace de una consulta, pero no hay razón de
  -- dominio para exigirlo (mismo criterio que radiografias.appointment_id).
  appointment_id uuid REFERENCES appointments(id),
  estatus        text NOT NULL DEFAULT 'borrador'
                 CHECK (estatus IN ('borrador', 'enviada', 'cancelada')),
  contenido      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Una orden por cita: el botón de la consulta abre/reutiliza LA orden de esa
-- visita, no crea una nueva cada vez que el médico entra al modal. Si algún
-- día se necesita una segunda orden en la misma cita, esto se revisita
-- explícitamente — hoy simplifica el caso de uso (get-or-create) sin costo.
CREATE UNIQUE INDEX IF NOT EXISTS ordenes_plantillas_appointment_uk
  ON ordenes_plantillas(appointment_id) WHERE appointment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ordenes_plantillas_tenant_idx ON ordenes_plantillas(tenant_id);
CREATE INDEX IF NOT EXISTS ordenes_plantillas_patient_idx ON ordenes_plantillas(patient_id);

ALTER TABLE ordenes_plantillas ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordenes_plantillas FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ordenes_plantillas
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON ordenes_plantillas TO healthflow_app;
