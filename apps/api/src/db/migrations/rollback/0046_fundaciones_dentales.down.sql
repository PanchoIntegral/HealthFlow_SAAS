-- Migración COMPENSATORIA de 0046 (§19: "reversible mediante una migración
-- compensatoria"). NO la aplica db:migrate — este directorio queda fuera del
-- runner a propósito. Se ejecuta a mano, como rol admin, solo para deshacer la
-- Fase A en un entorno donde todavía no hay módulos que dependan de ella.
--
-- Ojo: apagar un feature flag NO requiere esto. Apagar es UPDATE habilitado=false
-- (o borrar la fila); esto destruye la infraestructura completa, incluido el
-- historial de eventos internos.

DROP FUNCTION IF EXISTS complete_app_event(uuid, text, boolean, text);
DROP FUNCTION IF EXISTS claim_app_events(text, int);
DROP TABLE IF EXISTS app_event_consumptions;
DROP TABLE IF EXISTS app_events;
DROP FUNCTION IF EXISTS check_app_event_consumption_tenant();
DROP TABLE IF EXISTS tenant_feature_flags;
DROP FUNCTION IF EXISTS check_feature_flag_actor();

DELETE FROM _migrations WHERE name = '0046_fundaciones_dentales.sql';
