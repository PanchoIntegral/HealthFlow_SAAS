-- ═══════════════════════════════════════════════════════════════════
-- Presupuestos y cobranza.
--
-- Cubre el hueco entre diagnosticar y facturar: cotizar un plan de tratamiento
-- y cobrarlo en parcialidades a lo largo de meses. Es como se vende la
-- odontología, y hasta ahora el dentista lo llevaba fuera de HealthFlow.
--
-- El presupuesto cuelga del PACIENTE, no de la cita: un tratamiento abarca
-- varias sesiones, mientras que `facturas` tiene un índice único que garantiza
-- a lo sumo una factura viva por cita (ver 0006_billing.sql). Son cosas
-- distintas y por eso no se reusó aquella tabla.
--
-- NO hay columnas de total ni de saldo, a propósito. Se derivan de partidas y
-- abonos en cada lectura. Almacenarlos obligaría a mantenerlos sincronizados en
-- cada alta, baja y edición, y un saldo desfasado en un módulo de cobranza es
-- una discusión con el paciente frente al mostrador. Mismo criterio que ya
-- sigue `Factura`, que deriva sus totales de los conceptos.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS presupuestos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id     uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id      uuid NOT NULL REFERENCES users(id),
  titulo         text NOT NULL,
  estatus        text NOT NULL DEFAULT 'borrador'
                 CHECK (estatus IN ('borrador','presentado','aceptado','rechazado','terminado','cancelado')),
  notas          text,
  vigencia_hasta date,
  aceptado_en    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS presupuestos_paciente_idx ON presupuestos(patient_id);

-- El trabajo cotizado. `piezas` en notación FDI conecta el presupuesto con el
-- odontograma: el dentista marca caries en el 16 y de ahí sale la partida.
CREATE TABLE IF NOT EXISTS presupuesto_partidas (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  presupuesto_id          uuid NOT NULL REFERENCES presupuestos(id) ON DELETE CASCADE,
  descripcion             text NOT NULL,
  piezas                  text[] NOT NULL DEFAULT '{}',
  fase                    integer NOT NULL DEFAULT 1,
  cantidad                numeric(10,2) NOT NULL CHECK (cantidad > 0),
  -- En CENTAVOS enteros, igual que el dominio de facturación.
  valor_unitario_centavos bigint NOT NULL CHECK (valor_unitario_centavos >= 0),
  estatus                 text NOT NULL DEFAULT 'pendiente'
                          CHECK (estatus IN ('pendiente','en_proceso','terminado','cancelada')),
  -- Cita donde se ejecutó. Es lo que permite precargar los conceptos del CFDI
  -- de esa cita sin que el dentista recapture nada.
  appointment_id          uuid REFERENCES appointments(id),
  orden                   integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS partidas_presupuesto_idx ON presupuesto_partidas(presupuesto_id);
CREATE INDEX IF NOT EXISTS partidas_cita_idx ON presupuesto_partidas(appointment_id)
  WHERE appointment_id IS NOT NULL;

-- Los abonos son control de COBRANZA, no actos fiscales. Un CFDI se emite
-- aparte, por cita, con los conceptos del trabajo terminado.
CREATE TABLE IF NOT EXISTS presupuesto_abonos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  presupuesto_id uuid NOT NULL REFERENCES presupuestos(id) ON DELETE CASCADE,
  monto_centavos bigint NOT NULL CHECK (monto_centavos > 0),
  metodo         text NOT NULL CHECK (metodo IN ('efectivo','tarjeta','transferencia','otro')),
  fecha          date NOT NULL DEFAULT current_date,
  referencia     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS abonos_presupuesto_idx ON presupuesto_abonos(presupuesto_id);

-- Aislamiento multi-tenant, mismo patrón que el resto del esquema.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['presupuestos','presupuesto_partidas','presupuesto_abonos']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON presupuestos, presupuesto_partidas, presupuesto_abonos
  TO healthflow_app;
