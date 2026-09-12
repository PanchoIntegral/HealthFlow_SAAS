-- Commit 4: los dos huecos que impedían automatizar Recall sin adivinar.
--
-- 1. ¿QUÉ tratamiento genera un control y de qué tipo? Hasta ahora la única
--    pista era `presupuesto_partidas.descripcion`, texto libre que el
--    odontólogo escribe a mano. Inferir de ahí ("si dice limpieza…") produce
--    controles fantasma y se rompe con un acento o una falta de ortografía.
--    La relación se vuelve EXPLÍCITA y opcional: una partida sin tipo no
--    genera nada, que es el comportamiento seguro por omisión.
--
-- 2. ¿Qué pasa tras una inasistencia? Reactivar exige decidir con qué tipo y
--    en cuántos días. Sin configuración explícita no se inventa ninguno.

ALTER TABLE presupuesto_partidas
  ADD COLUMN recall_type_id uuid REFERENCES recall_types(id) ON DELETE SET NULL;

-- Parcial: la enorme mayoría de las partidas no genera control, y el índice
-- sólo existe para que el ON DELETE SET NULL no recorra la tabla entera.
CREATE INDEX presupuesto_partidas_recall_type_idx
  ON presupuesto_partidas (recall_type_id) WHERE recall_type_id IS NOT NULL;

-- ── Configuración de automatización por clínica ──────────────────
CREATE TABLE recall_settings (
  tenant_id uuid PRIMARY KEY DEFAULT current_tenant_id()
    REFERENCES tenants(id) ON DELETE CASCADE,
  /**
   * Tipo con el que se reactiva a quien no asistió. NULL = no reactivar.
   * Es una decisión de la clínica, no un valor por omisión del producto:
   * perseguir a un paciente que faltó puede ser correcto o inoportuno según
   * el tratamiento, y equivocarse gasta el único canal de contacto que hay.
   */
  no_show_recall_type_id uuid REFERENCES recall_types(id) ON DELETE SET NULL,
  /**
   * Días entre la inasistencia y el vencimiento del seguimiento. NO usa
   * `interval_months` del tipo: un no-show se persigue en días, no en meses,
   * y reutilizar el intervalo del control periódico daría un seguimiento
   * dentro de seis meses para alguien que faltó ayer.
   */
  no_show_delay_days int NOT NULL DEFAULT 1
    CHECK (no_show_delay_days BETWEEN 0 AND 30),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Coherencia de tenant donde la FK no alcanza ──────────────────
-- Las comprobaciones de llave foránea NO pasan por RLS: sin esto, una partida
-- podría apuntar al tipo de control de otra clínica y la FK lo aceptaría.
CREATE OR REPLACE FUNCTION check_recall_automation_tenant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tipo uuid;
BEGIN
  IF TG_TABLE_NAME = 'recall_settings' THEN
    v_tipo := NEW.no_show_recall_type_id;
  ELSE
    v_tipo := NEW.recall_type_id;
  END IF;

  IF v_tipo IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM recall_types WHERE id = v_tipo AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'recall type does not belong to tenant' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER recall_settings_tenant
  BEFORE INSERT OR UPDATE ON recall_settings
  FOR EACH ROW EXECUTE FUNCTION check_recall_automation_tenant();
-- Sólo cuando la columna cambia: una partida se actualiza en cada edición del
-- presupuesto y no tiene sentido revalidar un valor que no se tocó.
CREATE TRIGGER presupuesto_partidas_recall_type_tenant
  BEFORE INSERT OR UPDATE OF recall_type_id ON presupuesto_partidas
  FOR EACH ROW EXECUTE FUNCTION check_recall_automation_tenant();

ALTER TABLE recall_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE recall_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recall_settings
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON recall_settings TO healthflow_app;
-- No se borra: apagar la reactivación es poner el tipo en NULL, y así se
-- conserva la demora configurada para cuando vuelva a encenderse.
REVOKE DELETE ON recall_settings FROM healthflow_app;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='healthflow_worker') THEN
  GRANT SELECT ON recall_settings TO healthflow_worker;
  -- El consumidor de tratamientos terminados necesita leer de qué tipo es la
  -- partida que se completó.
  GRANT SELECT ON presupuesto_partidas TO healthflow_worker;
END IF; END $$;
