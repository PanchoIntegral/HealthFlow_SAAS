-- Migración COMPENSATORIA de 0054. No la aplica db:migrate; se ejecuta a mano
-- como rol admin. Sólo quita un índice: la auditoría sigue funcionando, más lenta.

DROP INDEX IF EXISTS audit_log_entidad_accion_idx;

DELETE FROM _migrations WHERE name = '0054_auditoria_notas.sql';
