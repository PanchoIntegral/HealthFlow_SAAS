-- ═══════════════════════════════════════════════════════════════════
-- Personalización del membrete de la receta impresa: logo de la clínica y
-- una leyenda libre para el pie.
--
-- `logo_storage_key` guarda la CLAVE del objeto en storage, no una URL: las
-- URLs firmadas expiran en minutos (ver R2Adapter), y esta columna hay que
-- poder leerla para siempre. `GetRecetaDetalleUseCase` resuelve una URL fresca
-- en cada lectura, mismo patrón que ya usa `radiografias`.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_storage_key text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS leyenda_pie text;
