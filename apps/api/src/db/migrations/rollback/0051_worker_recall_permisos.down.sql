-- Migración COMPENSATORIA de 0051. No la aplica db:migrate; se ejecuta a mano
-- como rol admin.
--
-- OJO: deshacer esto deja al worker sin poder auditar ni cancelar mensajes, es
-- decir, con los consumidores de Recall rotos. Sólo tiene sentido junto con el
-- rollback del módulo completo.

DROP FUNCTION IF EXISTS cancel_recall_pending_messages(uuid);
DROP FUNCTION IF EXISTS cancel_recall_attempt_messages(uuid);

DROP FUNCTION IF EXISTS record_system_audit(uuid, text, uuid, text, jsonb);

DELETE FROM _migrations WHERE name = '0051_worker_recall_permisos.sql';
