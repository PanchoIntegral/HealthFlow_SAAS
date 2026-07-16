-- ═══════════════════════════════════════════════════════════════════
-- Facturación CFDI 4.0.
--   emisores_fiscales   : datos fiscales de la clínica (uno por tenant, MVP).
--   receptores_fiscales : datos fiscales del paciente/cliente.
--   facturas            : cabecera del CFDI, máquina de estados
--                         PENDIENTE → TIMBRADA → CANCELADA (ERROR reintentable).
--   conceptos_factura   : renglones del CFDI. INMUTABLES una vez insertados.
-- Todas con RLS + DEFAULT current_tenant_id() (mismo patrón que patients).
-- Las FKs de facturas NO llevan ON DELETE CASCADE a propósito: una factura
-- timbrada no debe poder desaparecer por borrar en cascada emisor/receptor/cita.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS emisores_fiscales (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  rfc              text NOT NULL,
  razon_social     text NOT NULL,
  regimen_fiscal   text NOT NULL,
  codigo_postal    text NOT NULL,
  facturapi_org_id text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id) -- un emisor por clínica (MVP)
);

CREATE TABLE IF NOT EXISTS receptores_fiscales (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id     uuid REFERENCES patients(id),
  rfc            text NOT NULL,
  razon_social   text NOT NULL,
  regimen_fiscal text NOT NULL,
  codigo_postal  text NOT NULL,
  uso_cfdi       text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS receptores_fiscales_tenant_idx ON receptores_fiscales(tenant_id);

CREATE TABLE IF NOT EXISTS facturas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  appointment_id     uuid NOT NULL REFERENCES appointments(id),
  emisor_id          uuid NOT NULL REFERENCES emisores_fiscales(id),
  receptor_id        uuid NOT NULL REFERENCES receptores_fiscales(id),
  estatus            text NOT NULL DEFAULT 'PENDIENTE'
                     CHECK (estatus IN ('PENDIENTE','TIMBRADA','CANCELADA','ERROR')),
  uuid_fiscal        text UNIQUE,
  subtotal           numeric(12,2) NOT NULL,
  iva                numeric(12,2) NOT NULL,
  total              numeric(12,2) NOT NULL,
  pac_raw_id         text,
  error_code         text,
  motivo_cancelacion text,
  timbrada_en        timestamptz,
  cancelada_en       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facturas_tenant_idx ON facturas(tenant_id);

-- IDEMPOTENCIA: a lo sumo UNA factura "viva" (PENDIENTE o TIMBRADA) por cita.
-- Cierra la carrera del doble submit: el perdedor recibe 23505 y el repo lo
-- traduce a FacturaYaEmitidaError. ERROR/CANCELADA quedan fuera del predicado,
-- así que reintentar tras error o re-facturar tras cancelar sí es posible.
CREATE UNIQUE INDEX IF NOT EXISTS facturas_appointment_activa_uq
  ON facturas(appointment_id) WHERE estatus IN ('PENDIENTE','TIMBRADA');

CREATE TABLE IF NOT EXISTS conceptos_factura (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  factura_id      uuid NOT NULL REFERENCES facturas(id),
  clave_prod_serv text NOT NULL,
  clave_unidad    text NOT NULL,
  descripcion     text NOT NULL,
  cantidad        numeric(12,2) NOT NULL CHECK (cantidad > 0),
  valor_unitario  numeric(12,2) NOT NULL CHECK (valor_unitario >= 0),
  importe         numeric(12,2) NOT NULL CHECK (importe >= 0),
  -- Tratamiento de IVA por concepto: consulta médica suele ser EXENTO (art. 15 LIVA).
  tratamiento_iva text NOT NULL DEFAULT 'EXENTO'
                  CHECK (tratamiento_iva IN ('EXENTO','TASA_16','TASA_0')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conceptos_factura_factura_idx ON conceptos_factura(factura_id);

-- RLS por tenant para las cuatro tablas (misma política que el resto).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['emisores_fiscales','receptores_fiscales','facturas','conceptos_factura']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t
    );
  END LOOP;
END $$;
