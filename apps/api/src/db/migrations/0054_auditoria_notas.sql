-- Auditoría de edición de notas clínicas.
--
-- El autosave consulta el ÚLTIMO registro `save_draft` de la nota para decidir
-- si vale la pena registrar otro (cambio de contenido + ventana de tiempo).
-- Sin índice, esa consulta recorre la bitácora completa de la clínica en cada
-- guardado automático, que ocurre cada pocos segundos mientras se escribe.
CREATE INDEX IF NOT EXISTS audit_log_entidad_accion_idx
  ON audit_log (entidad_id, accion, created_at DESC)
  WHERE entidad_id IS NOT NULL;
