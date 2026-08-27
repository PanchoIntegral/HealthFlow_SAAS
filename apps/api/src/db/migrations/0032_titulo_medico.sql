-- ═══════════════════════════════════════════════════════════════════
-- Título con el que el médico firma sus documentos impresos: "Dr." o "Dra.".
--
-- Es del USUARIO y no del tenant, por la misma razón que la cédula: en un
-- mismo consultorio firman un doctor y una doctora, y el membrete debe
-- respetar a cada quien.
--
-- Nullable y sin default: NULL significa "sin título en el membrete", que es
-- exactamente como se imprimen hoy todas las recetas ya emitidas. Poner un
-- default convertiría en "Dr." a toda la base con una migración silenciosa —
-- incluidas las doctoras.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN IF NOT EXISTS titulo text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_titulo_check'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_titulo_check
      CHECK (titulo IS NULL OR titulo IN ('Dr.', 'Dra.'));
  END IF;
END $$;
