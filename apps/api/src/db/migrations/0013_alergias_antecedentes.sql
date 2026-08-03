-- ═══════════════════════════════════════════════════════════════════
-- Alergias y antecedentes del paciente.
--
-- Hasta ahora `patients` solo guardaba nombre, fecha de nacimiento, CURP y
-- teléfono: no había DÓNDE anotar que alguien es alérgico a la penicilina. En
-- odontología eso se vuelve crítico a diario, porque se infiltra anestésico en
-- casi toda consulta, pero el hueco afectaba a todas las especialidades.
--
-- Van en el paciente y no en la nota: son permanentes y deben aparecer en cada
-- consulta, no solo en aquella donde alguien los tecleó.
--
-- `sin_alergias_conocidas` es una columna aparte a propósito. Una lista vacía
-- es ambigua —¿no tiene alergias, o nadie preguntó?— y esa ambigüedad es justo
-- la peligrosa. Con la declaración explícita, la interfaz puede distinguir
-- "sin alergias conocidas" de "sin información".
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE patients
  ADD COLUMN sin_alergias_conocidas boolean NOT NULL DEFAULT false,
  ADD COLUMN alergias      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN antecedentes  jsonb NOT NULL DEFAULT '{"banderas": []}'::jsonb;

-- Permite responder "¿qué pacientes son alérgicos a X?" sin escanear la tabla.
-- Útil para avisos y, llegado el caso, para una retirada de medicamento.
CREATE INDEX IF NOT EXISTS patients_alergias_idx ON patients USING gin (alergias);

COMMENT ON COLUMN patients.alergias IS
  'Arreglo de {sustancia, tipo, severidad, notas}. Ver Alergia en @healthflow/shared-types.';
COMMENT ON COLUMN patients.antecedentes IS
  'Banderas clínicas (ver BANDERAS_CLINICAS) más antecedentes en texto libre.';
