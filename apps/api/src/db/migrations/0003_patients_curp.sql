-- CURP única por clínica (cuando está presente). Permite NULL (pacientes sin
-- CURP registrada) pero impide duplicados dentro del mismo tenant.
CREATE UNIQUE INDEX IF NOT EXISTS patients_tenant_curp_uidx
  ON patients (tenant_id, curp)
  WHERE curp IS NOT NULL;

-- Autocompleta tenant_id con el tenant activo de la transacción. Junto con la
-- política RLS (WITH CHECK), el código de app jamás necesita —ni puede— fijar
-- un tenant ajeno al insertar. Si no hay tenant activo, current_tenant_id() es
-- NULL y el NOT NULL rechaza el insert (falla segura).
ALTER TABLE patients ALTER COLUMN tenant_id SET DEFAULT current_tenant_id();

-- Búsqueda por prefijo case-insensitive sobre nombre.
CREATE INDEX IF NOT EXISTS patients_nombre_lower_idx ON patients (lower(nombre) text_pattern_ops);
