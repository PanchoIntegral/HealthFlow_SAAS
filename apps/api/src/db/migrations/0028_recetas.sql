-- ═══════════════════════════════════════════════════════════════════
-- Receta médica (LGS art. 226; RIS arts. 28, 29, 64 y 65).
--
-- Documento HERMANO de la nota, no parte de ella — mismo criterio que
-- `ordenes_plantillas` (0023): una nota firmada es inmutable por NOM-004 y no
-- se puede reabrir, pero una receta a veces hay que reemitirla días después de
-- cerrada la consulta.
--
-- INSERT-ONLY, como `consentimientos` (0015) y por la misma razón elevada al
-- cuadrado: una receta emitida ya salió del consultorio en manos del paciente
-- y puede haberse surtido en una farmacia. Corregirla en la base sería
-- reescribir un documento que existe en papel allá afuera. Si algo está mal,
-- se cancela y se emite otra.
--
-- Por eso la cancelación vive en `recetas_cancelaciones` y NO en una columna
-- `estatus` de esta tabla: un estatus mutable obligaría a conceder UPDATE
-- sobre la receta entera, y con UPDATE concedido nada a nivel de base impide
-- reescribir la dosis. La tabla hermana da el mismo comportamiento de negocio
-- sin abrir esa puerta.
--
-- `contenido` guarda un SNAPSHOT del emisor, del paciente y de los
-- diagnósticos al momento de emitir; no se resuelve por JOIN al imprimir. Si
-- el médico actualiza su cédula o el paciente corrige su nombre el año que
-- entra, la reimpresión debe seguir mostrando lo que decía el papel que se
-- entregó. Mismo criterio que `contenido_nom004.firma` en las notas.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS recetas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id     uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id      uuid NOT NULL REFERENCES users(id),
  -- Nullable, igual que ordenes_plantillas.appointment_id: hoy toda receta
  -- nace de una consulta, pero recetar el control de un crónico por teléfono
  -- no es una cita y no hay razón de dominio para exigirla.
  appointment_id uuid REFERENCES appointments(id),
  -- El folio visible ('RX-2026-000123') más sus partes: el formato es
  -- presentación y puede cambiar, pero el par (anio, numero) es la llave real
  -- del consecutivo y es sobre la que se garantiza unicidad.
  folio          text     NOT NULL,
  folio_anio     smallint NOT NULL,
  folio_numero   integer  NOT NULL,
  contenido      jsonb    NOT NULL,   -- RecetaContent (shared-types)
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- SIN índice único por appointment_id, a diferencia de ordenes_plantillas: en
-- una misma consulta se emiten varias recetas legítimamente (una para el
-- antibiótico que se retiene y otra para el resto del tratamiento).
CREATE UNIQUE INDEX IF NOT EXISTS recetas_folio_uk
  ON recetas(tenant_id, folio);
CREATE UNIQUE INDEX IF NOT EXISTS recetas_consecutivo_uk
  ON recetas(tenant_id, folio_anio, folio_numero);
CREATE INDEX IF NOT EXISTS recetas_patient_idx ON recetas(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recetas_tenant_idx  ON recetas(tenant_id);

ALTER TABLE recetas ENABLE ROW LEVEL SECURITY;
ALTER TABLE recetas FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recetas
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- El REVOKE no es redundante con el GRANT: 0001_rls.sql fija
-- `ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE, DELETE`, así que
-- toda tabla nueva nace con los cuatro permisos y hay que quitarlos a mano.
GRANT  SELECT, INSERT ON recetas TO healthflow_app;
REVOKE UPDATE, DELETE ON recetas FROM healthflow_app;


-- ── Cancelación ──────────────────────────────────────────────────
-- También insert-only: "descancelar" no es un caso de uso, es reescribir la
-- historia. UNIQUE sobre receta_id porque cancelar dos veces no significa
-- nada, y así la segunda cancelación falla en la base aunque el caso de uso
-- tuviera un hueco de concurrencia.
CREATE TABLE IF NOT EXISTS recetas_cancelaciones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  receta_id     uuid NOT NULL UNIQUE REFERENCES recetas(id) ON DELETE CASCADE,
  cancelado_por uuid NOT NULL REFERENCES users(id),
  motivo        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE recetas_cancelaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE recetas_cancelaciones FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recetas_cancelaciones
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

GRANT  SELECT, INSERT ON recetas_cancelaciones TO healthflow_app;
REVOKE UPDATE, DELETE ON recetas_cancelaciones FROM healthflow_app;


-- ── Folios consecutivos ──────────────────────────────────────────
-- Primer generador de consecutivos del sistema: todo lo demás usa uuid. Una
-- receta necesita un número que un humano pueda dictar por teléfono a la
-- farmacia, y que sea consecutivo POR CLÍNICA — el folio 12 de una clínica no
-- tiene nada que ver con el folio 12 de otra, así que una SEQUENCE global de
-- Postgres no sirve (además de filtrar el volumen de emisión entre clínicas).
--
-- Tabla contador con upsert atómico, y NO `MAX(folio_numero) + 1`: ese patrón
-- tiene la carrera clásica —dos transacciones leen el mismo máximo— y el
-- índice único solo la convierte en un error que hay que reintentar bien.
-- Aquí el ON CONFLICT DO UPDATE toma el lock de la fila del contador: la
-- segunda transacción espera y obtiene el número siguiente, sin reintentos.
--
-- ESTA tabla sí necesita UPDATE; es su razón de existir, y es también por lo
-- que el contador no puede ser una columna de `tenants` (esa tabla no concede
-- UPDATE al rol de la app). DELETE sí se revoca: borrar el contador
-- reiniciaría la numeración de una clínica en producción, que es justo lo que
-- un folio no debe poder hacer.
--
-- `serie` deja lugar a folios por sucursal o por tipo de documento sin migrar
-- nada; hoy siempre vale 'RX'.
CREATE TABLE IF NOT EXISTS folio_contadores (
  tenant_id  uuid     NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  serie      text     NOT NULL,
  anio       smallint NOT NULL,
  ultimo     integer  NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, serie, anio)
);

ALTER TABLE folio_contadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_contadores FORCE  ROW LEVEL SECURITY;
-- USING y WITH CHECK son AMBOS indispensables aquí, y no por simetría: sin
-- USING, el ON CONFLICT DO UPDATE no vería la fila con la que choca y el
-- upsert fallaría con violación de llave primaria en vez de incrementar.
CREATE POLICY tenant_isolation ON folio_contadores
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

GRANT  SELECT, INSERT, UPDATE ON folio_contadores TO healthflow_app;
REVOKE DELETE                 ON folio_contadores FROM healthflow_app;
