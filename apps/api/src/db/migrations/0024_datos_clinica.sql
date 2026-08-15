-- ═══════════════════════════════════════════════════════════════════
-- Datos de membrete: dirección y teléfono de la clínica, y cédula de
-- especialidad del médico.
--
-- Los detona la orden de plantillas ortopédicas: para que el documento
-- impreso sea reconocible por el laboratorio como una orden formal (y no una
-- hoja suelta con un UUID de sistema), necesita el mismo tipo de encabezado
-- que trae el papel original — clínica, dirección, teléfono, médico con sus
-- dos cédulas (profesional y de especialidad).
--
-- `cedula_especialidad` es DISTINTA de `cedula_profesional` (ya existente,
-- ver 0013): la profesional habilita ejercer la medicina en general: la de
-- especialidad certifica la especialidad concreta (podiatría, en el caso que
-- lo pidió). Un médico puede tener la primera sin la segunda.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS direccion text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS telefono text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cedula_especialidad text;
