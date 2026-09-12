-- Migración COMPENSATORIA de 0050. No la aplica db:migrate; se ejecuta a mano
-- como rol admin. Pierde la asociación partida→tipo de control y la
-- configuración de reactivación por inasistencia; los controles ya creados
-- quedan intactos.

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='healthflow_worker') THEN
  REVOKE SELECT ON recall_settings, presupuesto_partidas FROM healthflow_worker;
END IF; END $$;

DROP TRIGGER IF EXISTS presupuesto_partidas_recall_type_tenant ON presupuesto_partidas;
DROP TRIGGER IF EXISTS recall_settings_tenant ON recall_settings;
DROP TABLE IF EXISTS recall_settings;
DROP FUNCTION IF EXISTS check_recall_automation_tenant();
DROP INDEX IF EXISTS presupuesto_partidas_recall_type_idx;
ALTER TABLE presupuesto_partidas DROP COLUMN IF EXISTS recall_type_id;

DELETE FROM _migrations WHERE name = '0050_recall_automation.sql';
