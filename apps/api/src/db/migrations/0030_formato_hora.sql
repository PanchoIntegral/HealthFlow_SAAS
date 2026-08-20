-- ═══════════════════════════════════════════════════════════════════
-- Preferencia personal de formato de hora: '12h' (con AM/PM) o '24h'.
--
-- Es del USUARIO, no del tenant: dos personas en la misma clínica pueden leer
-- la agenda distinto. Default '24h' para no cambiarle el hábito a nadie con
-- una migración silenciosa.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN IF NOT EXISTS formato_hora text NOT NULL DEFAULT '24h';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_formato_hora_check'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_formato_hora_check
      CHECK (formato_hora IN ('12h', '24h'));
  END IF;
END $$;
