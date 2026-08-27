-- ═══════════════════════════════════════════════════════════════════
-- Correcciones (adendas) de una nota clínica ya cerrada.
--
-- La NOM-004 no admite enmendaduras ni tachaduras: una nota firmada NO se
-- reescribe. Lo que sí permite —y lo que hace esta tabla— es agregar una
-- anotación aclaratoria, firmada y fechada por quien la hace, que se lee
-- junto a la nota original sin alterarla ni un carácter.
--
-- Por eso vive en su propia tabla y no dentro de `contenido_nom004`: tocar el
-- jsonb de la nota sería modificar el documento firmado, que es exactamente
-- lo que la norma prohíbe.
--
-- Igual que en `consentimientos` (0015) y a diferencia de `radiografias`
-- (0016), se revocan UPDATE y DELETE: una corrección es un acto médico-legal
-- firmado. Corregir una corrección se hace agregando otra, nunca borrándola.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS notas_correccion (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  clinical_note_id uuid NOT NULL REFERENCES clinical_notes(id) ON DELETE CASCADE,
  autor_id         uuid NOT NULL REFERENCES users(id),
  -- Nombre y cédula CONGELADOS al momento de firmar, igual que la firma de la
  -- nota y el emisor de la receta: si el médico corrige su cédula el año que
  -- viene, esta adenda debe seguir mostrando con qué datos se firmó.
  autor_nombre     text NOT NULL,
  autor_cedula     text,
  texto            text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notas_correccion_tenant_idx ON notas_correccion(tenant_id);
-- Se leen SIEMPRE junto a su nota y en orden cronológico: la lectura del
-- expediente pide todas las correcciones de una página de notas de un golpe.
CREATE INDEX IF NOT EXISTS notas_correccion_nota_idx
  ON notas_correccion(clinical_note_id, created_at);

ALTER TABLE notas_correccion ENABLE ROW LEVEL SECURITY;
ALTER TABLE notas_correccion FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notas_correccion
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT ON notas_correccion TO healthflow_app;
REVOKE UPDATE, DELETE ON notas_correccion FROM healthflow_app;
