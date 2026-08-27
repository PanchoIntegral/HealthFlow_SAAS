-- ═══════════════════════════════════════════════════════════════════
-- Apariencia de la receta impresa, configurable por cada consultorio.
--
-- jsonb y no columnas sueltas: son preferencias de presentación que van a
-- crecer (hoy tamaño de logo y color de acento, mañana otra cosa), y cada
-- opción nueva sería otra migración con su default. El objeto se lee
-- fusionado con CONFIG_RECETA_DEFAULT en la capa de aplicación, así que
-- '{}' significa "todo por omisión" y las claves que falten no rompen nada.
--
-- Importante: esto NO decide qué DATOS lleva la receta. Nombre, cédula,
-- institución del título y domicilio del establecimiento los exige el
-- artículo 64 del RIS y se imprimen siempre.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS config_receta jsonb NOT NULL DEFAULT '{}'::jsonb;
