-- ═══════════════════════════════════════════════════════════════════
-- Asistente de transcripción con IA.
--
-- El médico graba el audio de la consulta y un modelo lo convierte en un
-- BORRADOR de la nota que él revisa, corrige y firma. La IA nunca cierra ni
-- firma nada: el responsable del expediente sigue siendo una persona con
-- cédula (NOM-004), y eso no se delega.
--
-- Interruptor por consultorio y apagado por omisión, a propósito. Mandar el
-- audio de una consulta a un tercero (Google) es una decisión que toma cada
-- clínica con su aviso de privacidad en la mano, no algo que se prenda solo
-- porque salió la función. Por ahora se activa a mano; cuando se cobre, este
-- mismo flag es donde se engancha.
--
-- El audio NO se guarda en ningún lado: se procesa en memoria y se descarta.
-- Por eso esta migración no crea tabla alguna — no hay nada que persistir más
-- allá de la nota clínica, que ya existe.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS asistente_ia_activo boolean NOT NULL DEFAULT false;
