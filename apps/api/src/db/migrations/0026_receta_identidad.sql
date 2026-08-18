-- ═══════════════════════════════════════════════════════════════════
-- Datos de identidad que exige la receta médica y que el expediente aún no
-- captura. Prerrequisito de 0027/0028: sin estas dos columnas ninguna receta
-- impresa cumple el Reglamento de Insumos para la Salud.
--
-- `users.institucion_titulo` (RIS art. 64): junto al nombre y la cédula, la
-- receta debe decir qué institución expidió el título del médico. Es un dato
-- del MÉDICO y no de la clínica: dos médicos del mismo consultorio pueden
-- venir de universidades distintas, así que no cabe en `tenants` al lado de
-- la dirección (0024).
--
-- `patients.sexo` (RIS art. 65): va en el recetario junto con nombre y edad.
-- El CURP lo codifica (ver patient.entity.ts), pero no todo paciente tiene
-- CURP capturado y derivarlo de una cadena que el usuario puede teclear mal
-- sería peor que preguntarlo.
--
-- Ambas NULLABLE, a propósito: hay clínicas en producción con pacientes y
-- cuentas ya dados de alta, y un NOT NULL exigiría inventarles un valor.
-- Quien exige el dato es `RecetaValidator` al momento de emitir — el mismo
-- criterio que NOM004Validator, que no bloquea guardar un borrador sino
-- cerrar la nota.
--
-- 'no_especificado' NO es lo mismo que NULL, y la diferencia es la que hace
-- útil a la columna: NULL = nunca se preguntó, y es el caso que la UI
-- persigue pidiendo el dato antes de emitir; 'no_especificado' = se preguntó
-- y el paciente decidió no declararlo, y sí permite emitir. Mismo criterio
-- que `sin_alergias_conocidas` en 0013, que existe justamente para separar
-- "no tiene" de "no sabemos".
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE users    ADD COLUMN IF NOT EXISTS institucion_titulo text;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS sexo text;

-- DROP antes de ADD para que la migración pueda re-correrse: ADD CONSTRAINT
-- no admite IF NOT EXISTS.
ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_sexo_check;
ALTER TABLE patients ADD  CONSTRAINT patients_sexo_check
  CHECK (sexo IS NULL OR sexo IN ('masculino', 'femenino', 'no_especificado'));

COMMENT ON COLUMN users.institucion_titulo IS
  'Institución que expidió el título profesional (RIS art. 64). Requerido para emitir recetas.';
COMMENT ON COLUMN patients.sexo IS
  'Catálogo SEXOS_PACIENTE de @healthflow/shared-types. NULL = no capturado, distinto de no_especificado.';

-- Sin GRANT ni políticas: ambas tablas ya existen con sus permisos y su RLS
-- desde 0001_rls.sql. Agregar una columna no cambia nada de eso.
