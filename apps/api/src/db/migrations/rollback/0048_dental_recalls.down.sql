-- Migración COMPENSATORIA de 0048. No la aplica db:migrate; se ejecuta a mano
-- como rol admin, y sólo en un entorno donde el módulo de recall nunca se usó:
-- destruye los controles pendientes de todos los pacientes.

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='healthflow_worker') THEN
  REVOKE ALL ON recall_types, patient_recalls, recall_attempts FROM healthflow_worker;
  REVOKE SELECT ON patients, appointments, tenants, booking_settings FROM healthflow_worker;
END IF; END $$;

DROP TABLE IF EXISTS recall_attempts;
DROP TABLE IF EXISTS patient_recalls;
DROP TABLE IF EXISTS recall_types;
DROP FUNCTION IF EXISTS check_recall_tenant();

DELETE FROM _migrations WHERE name = '0048_dental_recalls.sql';
