-- Autocompleta tenant_id con el tenant activo de la transacción al agendar
-- una cita, igual que patients/clinical_records (ver 0003). El código de
-- aplicación nunca necesita —ni puede— fijar un tenant ajeno en el insert.
ALTER TABLE appointments ALTER COLUMN tenant_id SET DEFAULT current_tenant_id();

-- Índice para las consultas del calendario por rango de fechas.
CREATE INDEX IF NOT EXISTS appointments_inicio_idx ON appointments(inicio_programado);
