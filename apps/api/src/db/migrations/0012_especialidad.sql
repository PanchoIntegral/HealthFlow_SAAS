-- ═══════════════════════════════════════════════════════════════════
-- Especialidad del médico: personaliza su nota de evolución y prioriza
-- los diagnósticos CIE-10 de su área.
--
-- Columna NUEVA, separada de `especialidad` (texto libre que ya existe y se
-- usa para MOSTRAR al médico en el selector de agenda). Son cosas distintas:
-- aquélla es una etiqueta editable ("Cardiología intervencionista"), ésta es
-- una clave controlada del catálogo de shared-types que dirige el
-- comportamiento del software. Mezclarlas rompería a cualquiera que hoy tenga
-- texto libre.
--
-- DEFAULT 'general' = el comportamiento actual, sin personalización alguna.
-- Todas las cuentas existentes quedan exactamente como estaban.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE users
  ADD COLUMN especialidad_key text NOT NULL DEFAULT 'general';

-- Sin CHECK a propósito: el catálogo de especialidades vive en el código
-- (shared-types) y va a crecer. Un CHECK aquí obligaría a una migración cada
-- vez que se agregue una especialidad, y una clave desconocida ya degrada de
-- forma segura a 'general' en perfilDe() — nunca impide firmar una nota.
COMMENT ON COLUMN users.especialidad_key IS
  'Clave del catálogo PERFILES en @healthflow/shared-types. Desconocida ⇒ general.';
