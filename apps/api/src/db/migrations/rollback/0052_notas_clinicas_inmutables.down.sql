-- Migración COMPENSATORIA de 0052. No la aplica db:migrate; se ejecuta a mano
-- como rol admin.
--
-- OJO: sin el trigger, la inmutabilidad de las notas cerradas vuelve a
-- depender únicamente del código de aplicación.

DROP TRIGGER IF EXISTS clinical_notes_inmutable ON clinical_notes;
DROP FUNCTION IF EXISTS clinical_notes_inmutable();

DELETE FROM _migrations WHERE name = '0052_notas_clinicas_inmutables.sql';
