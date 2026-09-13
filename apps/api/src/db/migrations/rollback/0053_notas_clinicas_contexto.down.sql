-- Migración COMPENSATORIA de 0053. No la aplica db:migrate; se ejecuta a mano
-- como rol admin, y sólo junto con el despliegue del código anterior.
--
-- Qué se pierde: nada del documento clínico. Las notas creadas con v1 guardan
-- plantillaVersion, contextoNota y especialidad también dentro de
-- `contenido_nom004`, que no se toca. DROP COLUMN no dispara triggers de fila,
-- así que el trigger de inmutabilidad (0052) no lo impide ni se desactiva.
--
-- Qué cambia: el código anterior lee esas notas como legacy y valida con las
-- reglas viejas los BORRADORES v1 que sigan abiertos. Conviene cerrarlos o
-- descartarlos antes de revertir.

DROP TABLE IF EXISTS notas_v2_rollout;

DROP INDEX IF EXISTS clinical_notes_contexto_idx;

DROP TRIGGER IF EXISTS clinical_notes_sello_v2 ON clinical_notes;
DROP FUNCTION IF EXISTS clinical_notes_sello_v2();

ALTER TABLE clinical_notes
  DROP CONSTRAINT IF EXISTS clinical_notes_v2_completa,
  DROP COLUMN IF EXISTS plantilla_version,
  DROP COLUMN IF EXISTS contexto_nota,
  DROP COLUMN IF EXISTS especialidad;

DELETE FROM _migrations WHERE name = '0053_notas_clinicas_contexto.sql';
