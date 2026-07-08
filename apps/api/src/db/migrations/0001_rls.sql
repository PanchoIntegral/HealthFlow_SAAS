-- ═══════════════════════════════════════════════════════════════════
-- Row-Level Security: aislamiento multi-tenant a nivel de base de datos.
--
-- Aunque exista un bug en el código de aplicación, Postgres NUNCA permite
-- que una clínica lea filas de otra. El tenant activo se establece por
-- transacción con:  SELECT set_config('app.current_tenant', '<uuid>', true)
--
-- current_setting(..., true) => missing_ok: si no se seteó, devuelve NULL,
-- y NULL no iguala a ningún tenant_id => la política NIEGA por defecto.
-- ═══════════════════════════════════════════════════════════════════

-- El rol de aplicación (creado en src/db/setup.ts) recibe DML sobre las tablas.
GRANT USAGE ON SCHEMA public TO healthflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO healthflow_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO healthflow_app;

-- Función helper: tenant activo de la transacción (NULL si no se seteó).
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.current_tenant', true), '')::uuid $$;

-- Aplica RLS a cada tabla con tenant_id. FORCE => también aplica al dueño,
-- de modo que ni siquiera el owner puede saltarse el aislamiento por accidente.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenants','users','patients','appointments','audit_log']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- tenants: la fila propia es aquella cuyo id == tenant activo.
CREATE POLICY tenant_self_isolation ON tenants
  USING (id = current_tenant_id())
  WITH CHECK (id = current_tenant_id());

-- Tablas hijas: aisladas por su columna tenant_id.
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation ON patients
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation ON appointments
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation ON audit_log
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
