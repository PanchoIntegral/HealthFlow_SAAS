-- ═══════════════════════════════════════════════════════════════════
-- Archivado de pacientes (baja lógica).
--
-- Existe porque "eliminar un paciente" son DOS operaciones distintas que la
-- interfaz confunde en un solo botón:
--
--   1. Un paciente capturado por error o duplicado. Nunca hubo acto médico:
--      no es un expediente, es un dato mal tecleado. Ese sí se borra de
--      verdad, y el caso de uso comprueba la ausencia de actividad antes.
--
--   2. Un paciente real que ya no se atiende. Ahí NO hay nada que borrar:
--      la NOM-004-SSA3-2012 obliga a conservar el expediente al menos cinco
--      años desde el último acto médico, y los propios Términos y Condiciones
--      del servicio lo trasladan al cliente (cláusula 10.4). Ese se ARCHIVA:
--      desaparece de búsquedas y listados, y el expediente queda intacto.
--
-- Es la misma baja lógica que `users.activo` (0018), y por la misma razón que
-- allá se explicó: una cuenta inactiva conserva su historial porque notas,
-- citas y facturas siguen apuntando a alguien real. Aquí es más fuerte todavía
-- —el paciente ES el sujeto del expediente—, y además borrarlo dispararía los
-- ON DELETE CASCADE de nueve tablas, incluidas `consentimientos` y `recetas`,
-- que se diseñaron insert-only con REVOKE UPDATE, DELETE justamente para que
-- nadie pudiera borrarlas. El CASCADE actúa a nivel de llave foránea y se
-- salta ese REVOKE sin decir nada.
--
-- No se usa un booleano `archivado`: la FECHA responde "¿cuándo?" y el
-- `archivado_por` responde "¿quién?", que es lo que hace falta cuando alguien
-- reclama que su paciente desapareció. NULL = activo.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE patients ADD COLUMN IF NOT EXISTS archivado_en  timestamptz;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS archivado_por uuid REFERENCES users(id);

COMMENT ON COLUMN patients.archivado_en IS
  'Baja lógica. NULL = activo. El expediente se conserva (NOM-004, mínimo 5 años).';

-- Índice parcial para el listado y el buscador, que solo miran activos.
-- Parcial y no completo a propósito: los archivados son minoría y no se
-- consultan desde estas rutas, así que no tienen por qué engordar el índice.
CREATE INDEX IF NOT EXISTS patients_activos_nombre_idx
  ON patients (tenant_id, lower(nombre) text_pattern_ops)
  WHERE archivado_en IS NULL;

-- Sin GRANT: la tabla ya tiene sus permisos y su RLS desde 0001_rls.sql.
-- `patients` sí concede UPDATE y DELETE al rol de la app (a diferencia de
-- recetas o consentimientos), que es lo que permite archivar y lo que hace
-- que el borrado real dependa de una regla de DOMINIO y no de la base.
