-- ═══════════════════════════════════════════════════════════════════
-- Catálogo de medicamentos prescribibles.
--
-- Tabla de REFERENCIA global, sin tenant_id ni RLS, por la misma razón que
-- `cie10_diagnosticos` (0008): un principio activo no tiene dueño. Se consulta
-- con la conexión normal, no con TenantDbService.
--
-- ── Sobre las claves ──────────────────────────────────────────────
-- La PK es un SLUG PROPIO ('paracetamol-tab-500'), no la clave del Compendio
-- Nacional de Insumos para la Salud. `clave_cnis` existe, nullable, para
-- reconciliar contra el compendio cuando se cargue su exportación oficial
-- desde compendio.csg.gob.mx.
--
-- Es deliberado: inventar claves con la forma de las oficiales
-- ('010.000.0104.00') para rellenar el catálogo produciría identificadores que
-- PARECEN del CSG y designan otra cosa, y ese error viaja después a cualquier
-- integración que los crea buenos. Un slug se distingue a simple vista.
--
-- ── Sobre `fraccion` ──────────────────────────────────────────────
-- Es la del art. 226 de la Ley General de Salud y NO viene en el compendio:
-- se asigna cruzando contra los listados de estupefacientes (art. 234) y
-- psicotrópicos (art. 245). Es la columna de la que depende que el sistema
-- pueda NEGARSE a emitir:
--
--   I   estupefacientes .................. recetario especial COFEPRIS · NO emisible
--   II  psicotrópicos grupo II ........... recetario especial COFEPRIS · NO emisible
--   III psicotrópicos grupo III .......... receta que se retiene, hasta 2 resurtidos
--   IV  antibióticos y análogos .......... receta que se retiene
--   V   crónicos y demás con receta ...... receta que no se retiene
--   VI  libre venta ...................... no requiere receta
--
-- Los medicamentos de fracción I y II están en el catálogo A PROPÓSITO, aunque
-- el sistema no pueda emitirlos. Si no estuvieran, el médico los capturaría
-- por el escape hatch de texto libre —donde la fracción es desconocida y el
-- bloqueo no puede dispararse— y acabaría imprimiendo en papel membretado algo
-- que solo vale en el recetario foliado de COFEPRIS. Están aquí para poder
-- decir que no.
--
-- ── Alcance de esta semilla ───────────────────────────────────────
-- Subconjunto de arranque para consulta general, odontología y podología: lo
-- que se prescribe a diario, más los controlados que hay que saber bloquear.
-- NO es el compendio completo (~14 800 claves, en su mayoría material de
-- curación, prótesis e instrumental, que no se prescriben en receta). El
-- médico puede prescribir fuera de catálogo por texto libre, así que un hueco
-- aquí no lo bloquea.
--
-- Antes de publicar la función, esta lista y en particular la columna
-- `fraccion` deben revisarse contra el compendio vigente y los artículos 234 y
-- 245 de la LGS. Actualizaciones del compendio: acnis.csg.gob.mx
-- ═══════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS medicamentos (
  clave                 text PRIMARY KEY,
  /** Clave del compendio del CSG, cuando se haya reconciliado. */
  clave_cnis            text,
  denominacion_generica text NOT NULL,
  forma_farmaceutica    text NOT NULL,
  presentacion          text NOT NULL,
  /** Precarga la vía en la UI; el médico puede cambiarla (RIS art. 29). */
  via_sugerida          text NOT NULL,
  grupo_terapeutico     text NOT NULL,
  fraccion              smallint NOT NULL CHECK (fraccion BETWEEN 1 AND 6)
);

-- Índices trigram, igual que 0008: el buscador hace ILIKE '%q%' y ordena por
-- similarity(), y ninguno de los dos usa un B-tree.
CREATE INDEX IF NOT EXISTS medicamentos_generica_trgm_idx
  ON medicamentos USING gin (denominacion_generica gin_trgm_ops);
CREATE INDEX IF NOT EXISTS medicamentos_grupo_trgm_idx
  ON medicamentos USING gin (grupo_terapeutico gin_trgm_ops);

INSERT INTO medicamentos
  (clave, denominacion_generica, forma_farmaceutica, presentacion, via_sugerida, grupo_terapeutico, fraccion)
VALUES
  -- ── Fracción I — estupefacientes (NO emisibles) ────────────────
  ('morfina-sol-iny-10',      'Morfina',        'Solución inyectable', 'Ampolleta de 10 mg/mL',       'Intravenosa', 'Analgésicos opioides', 1),
  ('morfina-tab-30',          'Morfina',        'Tableta',             'Tableta de liberación prolongada de 30 mg', 'Oral', 'Analgésicos opioides', 1),
  ('fentanilo-sol-iny',       'Fentanilo',      'Solución inyectable', 'Ampolleta de 0.5 mg/10 mL',   'Intravenosa', 'Analgésicos opioides', 1),
  ('fentanilo-parche-25',     'Fentanilo',      'Parche',              'Parche transdérmico de 25 mcg/h', 'Transdérmica', 'Analgésicos opioides', 1),
  ('oxicodona-tab-10',        'Oxicodona',      'Tableta',             'Tableta de liberación prolongada de 10 mg', 'Oral', 'Analgésicos opioides', 1),
  ('hidromorfona-tab-4',      'Hidromorfona',   'Tableta',             'Tableta de 4 mg',             'Oral', 'Analgésicos opioides', 1),
  ('metadona-tab-40',         'Metadona',       'Tableta',             'Tableta de 40 mg',            'Oral', 'Analgésicos opioides', 1),
  ('buprenorfina-parche-5',   'Buprenorfina',   'Parche',              'Parche transdérmico de 5 mcg/h', 'Transdérmica', 'Analgésicos opioides', 1),
  ('nalbufina-sol-iny-10',    'Nalbufina',      'Solución inyectable', 'Ampolleta de 10 mg/mL',       'Intramuscular', 'Analgésicos opioides', 1),

  -- ── Fracción II — psicotrópicos grupo II (NO emisibles) ────────
  ('clonazepam-tab-2',        'Clonazepam',     'Tableta',             'Caja con 30 tabletas de 2 mg', 'Oral', 'Ansiolíticos y anticonvulsivos', 2),
  ('clonazepam-got-2.5',      'Clonazepam',     'Solución',            'Frasco gotero de 2.5 mg/mL',  'Oral', 'Ansiolíticos y anticonvulsivos', 2),
  ('alprazolam-tab-0.5',      'Alprazolam',     'Tableta',             'Caja con 30 tabletas de 0.5 mg', 'Oral', 'Ansiolíticos', 2),
  ('diazepam-tab-10',         'Diazepam',       'Tableta',             'Caja con 20 tabletas de 10 mg', 'Oral', 'Ansiolíticos', 2),
  ('lorazepam-tab-1',         'Lorazepam',      'Tableta',             'Caja con 40 tabletas de 1 mg', 'Oral', 'Ansiolíticos', 2),
  ('midazolam-sol-iny-5',     'Midazolam',      'Solución inyectable', 'Ampolleta de 5 mg/5 mL',      'Intravenosa', 'Sedantes', 2),
  ('zolpidem-tab-10',         'Zolpidem',       'Tableta',             'Caja con 30 tabletas de 10 mg', 'Oral', 'Hipnóticos', 2),
  ('metilfenidato-tab-10',    'Metilfenidato',  'Tableta',             'Caja con 30 tabletas de 10 mg', 'Oral', 'Estimulantes del SNC', 2),
  ('lisdexanfetamina-cap-30', 'Lisdexanfetamina', 'Cápsula',           'Caja con 30 cápsulas de 30 mg', 'Oral', 'Estimulantes del SNC', 2),

  -- ── Fracción III — psicotrópicos grupo III ─────────────────────
  ('fenobarbital-tab-100',    'Fenobarbital',   'Tableta',             'Caja con 20 tabletas de 100 mg', 'Oral', 'Anticonvulsivos', 3),
  ('fenobarbital-sol-iny',    'Fenobarbital',   'Solución inyectable', 'Ampolleta de 330 mg/2 mL',    'Intramuscular', 'Anticonvulsivos', 3),

  -- ── Fracción IV — receta que se retiene ────────────────────────
  ('amoxicilina-cap-500',     'Amoxicilina',    'Cápsula',             'Caja con 12 cápsulas de 500 mg', 'Oral', 'Antibióticos — penicilinas', 4),
  ('amoxicilina-susp-250',    'Amoxicilina',    'Suspensión oral',     'Frasco de 75 mL con 250 mg/5 mL', 'Oral', 'Antibióticos — penicilinas', 4),
  ('amoxi-clav-tab-875',      'Amoxicilina/ácido clavulánico', 'Tableta', 'Caja con 12 tabletas de 875/125 mg', 'Oral', 'Antibióticos — penicilinas', 4),
  ('dicloxacilina-cap-500',   'Dicloxacilina',  'Cápsula',             'Caja con 20 cápsulas de 500 mg', 'Oral', 'Antibióticos — penicilinas', 4),
  ('penicilina-benz-1200',    'Penicilina G benzatínica', 'Suspensión inyectable', 'Frasco ámpula de 1 200 000 UI', 'Intramuscular', 'Antibióticos — penicilinas', 4),
  ('azitromicina-tab-500',    'Azitromicina',   'Tableta',             'Caja con 3 tabletas de 500 mg', 'Oral', 'Antibióticos — macrólidos', 4),
  ('claritromicina-tab-500',  'Claritromicina', 'Tableta',             'Caja con 10 tabletas de 500 mg', 'Oral', 'Antibióticos — macrólidos', 4),
  ('eritromicina-tab-500',    'Eritromicina',   'Tableta',             'Caja con 20 tabletas de 500 mg', 'Oral', 'Antibióticos — macrólidos', 4),
  ('cefalexina-cap-500',      'Cefalexina',     'Cápsula',             'Caja con 20 cápsulas de 500 mg', 'Oral', 'Antibióticos — cefalosporinas', 4),
  ('cefuroxima-tab-500',      'Cefuroxima',     'Tableta',             'Caja con 10 tabletas de 500 mg', 'Oral', 'Antibióticos — cefalosporinas', 4),
  ('ceftriaxona-sol-iny-1g',  'Ceftriaxona',    'Solución inyectable', 'Frasco ámpula de 1 g',        'Intramuscular', 'Antibióticos — cefalosporinas', 4),
  ('ciprofloxacino-tab-500',  'Ciprofloxacino', 'Tableta',             'Caja con 12 tabletas de 500 mg', 'Oral', 'Antibióticos — quinolonas', 4),
  ('levofloxacino-tab-500',   'Levofloxacino',  'Tableta',             'Caja con 7 tabletas de 500 mg', 'Oral', 'Antibióticos — quinolonas', 4),
  ('moxifloxacino-tab-400',   'Moxifloxacino',  'Tableta',             'Caja con 7 tabletas de 400 mg', 'Oral', 'Antibióticos — quinolonas', 4),
  ('tmp-smx-tab-160',         'Trimetoprima/sulfametoxazol', 'Tableta', 'Caja con 20 tabletas de 160/800 mg', 'Oral', 'Antibióticos — sulfonamidas', 4),
  ('doxiciclina-cap-100',     'Doxiciclina',    'Cápsula',             'Caja con 10 cápsulas de 100 mg', 'Oral', 'Antibióticos — tetraciclinas', 4),
  ('clindamicina-cap-300',    'Clindamicina',   'Cápsula',             'Caja con 16 cápsulas de 300 mg', 'Oral', 'Antibióticos — lincosamidas', 4),
  ('metronidazol-tab-500',    'Metronidazol',   'Tableta',             'Caja con 30 tabletas de 500 mg', 'Oral', 'Antiinfecciosos', 4),
  ('nitrofurantoina-cap-100', 'Nitrofurantoína', 'Cápsula',            'Caja con 40 cápsulas de 100 mg', 'Oral', 'Antibióticos urinarios', 4),
  ('fosfomicina-sob-3g',      'Fosfomicina',    'Polvo',               'Sobre con 3 g',               'Oral', 'Antibióticos urinarios', 4),
  ('gentamicina-sol-iny-80',  'Gentamicina',    'Solución inyectable', 'Ampolleta de 80 mg/2 mL',     'Intramuscular', 'Antibióticos — aminoglucósidos', 4),
  ('tramadol-cap-50',         'Tramadol',       'Cápsula',             'Caja con 20 cápsulas de 50 mg', 'Oral', 'Analgésicos opioides débiles', 4),
  ('tramadol-parac-tab',      'Tramadol/paracetamol', 'Tableta',       'Caja con 20 tabletas de 37.5/325 mg', 'Oral', 'Analgésicos opioides débiles', 4),
  ('ketorolaco-tab-10',       'Ketorolaco',     'Tableta',             'Caja con 10 tabletas de 10 mg', 'Oral', 'AINE', 4),
  ('ketorolaco-sol-iny-30',   'Ketorolaco',     'Solución inyectable', 'Ampolleta de 30 mg/mL',       'Intramuscular', 'AINE', 4),

  -- ── Fracción V — receta que no se retiene ──────────────────────
  ('metformina-tab-850',      'Metformina',     'Tableta',             'Caja con 30 tabletas de 850 mg', 'Oral', 'Antidiabéticos', 5),
  ('glibenclamida-tab-5',     'Glibenclamida',  'Tableta',             'Caja con 50 tabletas de 5 mg', 'Oral', 'Antidiabéticos', 5),
  ('linagliptina-tab-5',      'Linagliptina',   'Tableta',             'Caja con 30 tabletas de 5 mg', 'Oral', 'Antidiabéticos', 5),
  ('dapagliflozina-tab-10',   'Dapagliflozina', 'Tableta',             'Caja con 28 tabletas de 10 mg', 'Oral', 'Antidiabéticos', 5),
  ('insulina-glargina-100',   'Insulina glargina', 'Solución inyectable', 'Pluma precargada de 100 UI/mL, 3 mL', 'Subcutánea', 'Antidiabéticos', 5),
  ('insulina-nph-100',        'Insulina humana NPH', 'Suspensión inyectable', 'Frasco ámpula de 100 UI/mL, 10 mL', 'Subcutánea', 'Antidiabéticos', 5),
  ('losartan-tab-50',         'Losartán',       'Tableta',             'Caja con 30 tabletas de 50 mg', 'Oral', 'Antihipertensivos — ARA II', 5),
  ('telmisartan-tab-40',      'Telmisartán',    'Tableta',             'Caja con 30 tabletas de 40 mg', 'Oral', 'Antihipertensivos — ARA II', 5),
  ('enalapril-tab-10',        'Enalapril',      'Tableta',             'Caja con 30 tabletas de 10 mg', 'Oral', 'Antihipertensivos — IECA', 5),
  ('lisinopril-tab-10',       'Lisinopril',     'Tableta',             'Caja con 30 tabletas de 10 mg', 'Oral', 'Antihipertensivos — IECA', 5),
  ('amlodipino-tab-5',        'Amlodipino',     'Tableta',             'Caja con 30 tabletas de 5 mg', 'Oral', 'Antihipertensivos — calcioantagonistas', 5),
  ('metoprolol-tab-100',      'Metoprolol',     'Tableta',             'Caja con 20 tabletas de 100 mg', 'Oral', 'Betabloqueadores', 5),
  ('propranolol-tab-40',      'Propranolol',    'Tableta',             'Caja con 30 tabletas de 40 mg', 'Oral', 'Betabloqueadores', 5),
  ('hidroclorotiazida-tab-25','Hidroclorotiazida', 'Tableta',          'Caja con 20 tabletas de 25 mg', 'Oral', 'Diuréticos', 5),
  ('furosemida-tab-40',       'Furosemida',     'Tableta',             'Caja con 20 tabletas de 40 mg', 'Oral', 'Diuréticos', 5),
  ('espironolactona-tab-25',  'Espironolactona', 'Tableta',            'Caja con 30 tabletas de 25 mg', 'Oral', 'Diuréticos', 5),
  ('atorvastatina-tab-20',    'Atorvastatina',  'Tableta',             'Caja con 30 tabletas de 20 mg', 'Oral', 'Hipolipemiantes', 5),
  ('rosuvastatina-tab-10',    'Rosuvastatina',  'Tableta',             'Caja con 30 tabletas de 10 mg', 'Oral', 'Hipolipemiantes', 5),
  ('pravastatina-tab-20',     'Pravastatina',   'Tableta',             'Caja con 30 tabletas de 20 mg', 'Oral', 'Hipolipemiantes', 5),
  ('fenofibrato-cap-200',     'Fenofibrato',    'Cápsula',             'Caja con 30 cápsulas de 200 mg', 'Oral', 'Hipolipemiantes', 5),
  ('clopidogrel-tab-75',      'Clopidogrel',    'Tableta',             'Caja con 28 tabletas de 75 mg', 'Oral', 'Antiagregantes plaquetarios', 5),
  ('warfarina-tab-5',         'Warfarina',      'Tableta',             'Caja con 25 tabletas de 5 mg', 'Oral', 'Anticoagulantes', 5),
  ('rivaroxaban-tab-20',      'Rivaroxabán',    'Tableta',             'Caja con 28 tabletas de 20 mg', 'Oral', 'Anticoagulantes', 5),
  ('enoxaparina-sol-iny-40',  'Enoxaparina',    'Solución inyectable', 'Jeringa precargada de 40 mg/0.4 mL', 'Subcutánea', 'Anticoagulantes', 5),
  ('levotiroxina-tab-100',    'Levotiroxina',   'Tableta',             'Caja con 50 tabletas de 100 mcg', 'Oral', 'Hormonas tiroideas', 5),
  ('metimazol-tab-5',         'Metimazol',      'Tableta',             'Caja con 20 tabletas de 5 mg', 'Oral', 'Antitiroideos', 5),
  ('prednisona-tab-50',       'Prednisona',     'Tableta',             'Caja con 20 tabletas de 50 mg', 'Oral', 'Corticoesteroides', 5),
  ('dexametasona-sol-iny-8',  'Dexametasona',   'Solución inyectable', 'Ampolleta de 8 mg/2 mL',      'Intramuscular', 'Corticoesteroides', 5),
  ('betametasona-crema',      'Betametasona',   'Crema',               'Tubo con 30 g al 0.05 %',     'Tópica', 'Corticoesteroides tópicos', 5),
  ('hidrocortisona-crema-1',  'Hidrocortisona', 'Crema',               'Tubo con 30 g al 1 %',        'Tópica', 'Corticoesteroides tópicos', 5),
  ('salbutamol-inh-100',      'Salbutamol',     'Aerosol',             'Inhalador de 100 mcg por disparo, 200 dosis', 'Inhalada', 'Broncodilatadores', 5),
  ('budesonida-form-inh',     'Budesonida/formoterol', 'Aerosol',      'Inhalador de 160/4.5 mcg, 120 dosis', 'Inhalada', 'Broncodilatadores', 5),
  ('montelukast-tab-10',      'Montelukast',    'Tableta',             'Caja con 30 tabletas de 10 mg', 'Oral', 'Antiasmáticos', 5),
  ('sertralina-tab-50',       'Sertralina',     'Tableta',             'Caja con 30 tabletas de 50 mg', 'Oral', 'Antidepresivos ISRS', 5),
  ('fluoxetina-cap-20',       'Fluoxetina',     'Cápsula',             'Caja con 30 cápsulas de 20 mg', 'Oral', 'Antidepresivos ISRS', 5),
  ('escitalopram-tab-10',     'Escitalopram',   'Tableta',             'Caja con 28 tabletas de 10 mg', 'Oral', 'Antidepresivos ISRS', 5),
  ('amitriptilina-tab-25',    'Amitriptilina',  'Tableta',             'Caja con 20 tabletas de 25 mg', 'Oral', 'Antidepresivos tricíclicos', 5),
  ('gabapentina-cap-300',     'Gabapentina',    'Cápsula',             'Caja con 30 cápsulas de 300 mg', 'Oral', 'Neuromoduladores', 5),
  ('pregabalina-cap-75',      'Pregabalina',    'Cápsula',             'Caja con 28 cápsulas de 75 mg', 'Oral', 'Neuromoduladores', 5),
  ('carbamazepina-tab-200',   'Carbamazepina',  'Tableta',             'Caja con 20 tabletas de 200 mg', 'Oral', 'Anticonvulsivos', 5),
  ('acido-valproico-tab-200', 'Ácido valproico', 'Tableta',            'Caja con 40 tabletas de 200 mg', 'Oral', 'Anticonvulsivos', 5),
  ('levetiracetam-tab-500',   'Levetiracetam',  'Tableta',             'Caja con 30 tabletas de 500 mg', 'Oral', 'Anticonvulsivos', 5),
  ('alopurinol-tab-300',      'Alopurinol',     'Tableta',             'Caja con 20 tabletas de 300 mg', 'Oral', 'Antigotosos', 5),
  ('colchicina-tab-1',        'Colchicina',     'Tableta',             'Caja con 30 tabletas de 1 mg', 'Oral', 'Antigotosos', 5),
  ('diclofenaco-tab-100',     'Diclofenaco',    'Tableta',             'Caja con 20 tabletas de 100 mg', 'Oral', 'AINE', 5),
  ('meloxicam-tab-15',        'Meloxicam',      'Tableta',             'Caja con 10 tabletas de 15 mg', 'Oral', 'AINE', 5),
  ('celecoxib-cap-200',       'Celecoxib',      'Cápsula',             'Caja con 20 cápsulas de 200 mg', 'Oral', 'AINE', 5),
  ('indometacina-cap-25',     'Indometacina',   'Cápsula',             'Caja con 30 cápsulas de 25 mg', 'Oral', 'AINE', 5),
  ('metocarbamol-tab-750',    'Metocarbamol',   'Tableta',             'Caja con 20 tabletas de 750 mg', 'Oral', 'Relajantes musculares', 5),
  ('ciclobenzaprina-tab-10',  'Ciclobenzaprina', 'Tableta',            'Caja con 20 tabletas de 10 mg', 'Oral', 'Relajantes musculares', 5),
  ('pantoprazol-tab-40',      'Pantoprazol',    'Tableta',             'Caja con 14 tabletas de 40 mg', 'Oral', 'Inhibidores de bomba de protones', 5),
  ('esomeprazol-cap-40',      'Esomeprazol',    'Cápsula',             'Caja con 14 cápsulas de 40 mg', 'Oral', 'Inhibidores de bomba de protones', 5),
  ('ondansetron-tab-8',       'Ondansetrón',    'Tableta',             'Caja con 10 tabletas de 8 mg', 'Oral', 'Antieméticos', 5),
  ('metoclopramida-tab-10',   'Metoclopramida', 'Tableta',             'Caja con 20 tabletas de 10 mg', 'Oral', 'Antieméticos', 5),
  ('butilhioscina-tab-10',    'Butilhioscina',  'Tableta',             'Caja con 10 tabletas de 10 mg', 'Oral', 'Antiespasmódicos', 5),
  ('fluconazol-cap-150',      'Fluconazol',     'Cápsula',             'Caja con 1 cápsula de 150 mg', 'Oral', 'Antimicóticos', 5),
  ('itraconazol-cap-100',     'Itraconazol',    'Cápsula',             'Caja con 15 cápsulas de 100 mg', 'Oral', 'Antimicóticos', 5),
  ('terbinafina-tab-250',     'Terbinafina',    'Tableta',             'Caja con 14 tabletas de 250 mg', 'Oral', 'Antimicóticos', 5),
  ('terbinafina-crema-1',     'Terbinafina',    'Crema',               'Tubo con 15 g al 1 %',        'Tópica', 'Antimicóticos tópicos', 5),
  ('ketoconazol-crema-2',     'Ketoconazol',    'Crema',               'Tubo con 30 g al 2 %',        'Tópica', 'Antimicóticos tópicos', 5),
  ('clotrimazol-crema-1',     'Clotrimazol',    'Crema',               'Tubo con 20 g al 1 %',        'Tópica', 'Antimicóticos tópicos', 5),
  ('miconazol-polvo-2',       'Miconazol',      'Polvo',               'Frasco con 70 g al 2 %',      'Tópica', 'Antimicóticos tópicos', 5),
  ('amorolfina-laca-5',       'Amorolfina',     'Laca ungueal',        'Frasco con 2.5 mL al 5 %',    'Tópica', 'Antimicóticos tópicos', 5),
  ('ciclopirox-laca-8',       'Ciclopirox',     'Laca ungueal',        'Frasco con 3.3 mL al 8 %',    'Tópica', 'Antimicóticos tópicos', 5),
  ('aciclovir-tab-400',       'Aciclovir',      'Tableta',             'Caja con 35 tabletas de 400 mg', 'Oral', 'Antivirales', 5),
  ('mupirocina-ung-2',        'Mupirocina',     'Ungüento',            'Tubo con 15 g al 2 %',        'Tópica', 'Antibióticos tópicos', 5),
  ('acido-fusidico-crema-2',  'Ácido fusídico', 'Crema',               'Tubo con 15 g al 2 %',        'Tópica', 'Antibióticos tópicos', 5),
  ('neomicina-bacitracina',   'Neomicina/bacitracina', 'Ungüento',     'Tubo con 15 g',               'Tópica', 'Antibióticos tópicos', 5),
  ('clorhexidina-sol-012',    'Clorhexidina',   'Solución',            'Frasco con 240 mL al 0.12 %', 'Bucal', 'Antisépticos bucales', 5),
  ('benzocaina-gel-20',       'Benzocaína',     'Gel',                 'Tubo con 15 g al 20 %',       'Bucal', 'Anestésicos tópicos', 5),
  ('lidocaina-sol-iny-2',     'Lidocaína',      'Solución inyectable', 'Cartucho de 1.8 mL al 2 % con epinefrina', 'Infiltración', 'Anestésicos locales', 5),
  ('articaina-sol-iny-4',     'Articaína',      'Solución inyectable', 'Cartucho de 1.8 mL al 4 % con epinefrina', 'Infiltración', 'Anestésicos locales', 5),
  ('urea-crema-40',           'Urea',           'Crema',               'Tubo con 100 g al 40 %',      'Tópica', 'Queratolíticos', 5),
  ('acido-salicilico-ung-10', 'Ácido salicílico', 'Ungüento',          'Tubo con 30 g al 10 %',       'Tópica', 'Queratolíticos', 5),
  ('acido-folico-tab-5',      'Ácido fólico',   'Tableta',             'Caja con 90 tabletas de 5 mg', 'Oral', 'Vitaminas y minerales', 5),
  ('hierro-sulfato-tab',      'Sulfato ferroso', 'Tableta',            'Caja con 30 tabletas de 200 mg', 'Oral', 'Vitaminas y minerales', 5),
  ('complejo-b-sol-iny',      'Complejo B',     'Solución inyectable', 'Ampolleta de 2 mL',           'Intramuscular', 'Vitaminas y minerales', 5),

  -- ── Fracción VI — libre venta ──────────────────────────────────
  ('paracetamol-tab-500',     'Paracetamol',    'Tableta',             'Caja con 10 tabletas de 500 mg', 'Oral', 'Analgésicos y antipiréticos', 6),
  ('paracetamol-susp-100',    'Paracetamol',    'Suspensión oral',     'Frasco de 60 mL con 100 mg/mL', 'Oral', 'Analgésicos y antipiréticos', 6),
  ('ibuprofeno-tab-400',      'Ibuprofeno',     'Tableta',             'Caja con 10 tabletas de 400 mg', 'Oral', 'AINE', 6),
  ('ibuprofeno-susp-100',     'Ibuprofeno',     'Suspensión oral',     'Frasco de 120 mL con 100 mg/5 mL', 'Oral', 'AINE', 6),
  ('naproxeno-tab-250',       'Naproxeno',      'Tableta',             'Caja con 30 tabletas de 250 mg', 'Oral', 'AINE', 6),
  ('acido-acetilsalicilico',  'Ácido acetilsalicílico', 'Tableta',     'Caja con 20 tabletas de 500 mg', 'Oral', 'Analgésicos y antipiréticos', 6),
  ('aspirina-protect-100',    'Ácido acetilsalicílico', 'Tableta',     'Caja con 28 tabletas de 100 mg', 'Oral', 'Antiagregantes plaquetarios', 6),
  ('loratadina-tab-10',       'Loratadina',     'Tableta',             'Caja con 20 tabletas de 10 mg', 'Oral', 'Antihistamínicos', 6),
  ('cetirizina-tab-10',       'Cetirizina',     'Tableta',             'Caja con 10 tabletas de 10 mg', 'Oral', 'Antihistamínicos', 6),
  ('clorfenamina-tab-4',      'Clorfenamina',   'Tableta',             'Caja con 20 tabletas de 4 mg', 'Oral', 'Antihistamínicos', 6),
  ('omeprazol-cap-20',        'Omeprazol',      'Cápsula',             'Caja con 14 cápsulas de 20 mg', 'Oral', 'Inhibidores de bomba de protones', 6),
  ('ranitidina-tab-150',      'Ranitidina',     'Tableta',             'Caja con 20 tabletas de 150 mg', 'Oral', 'Antiácidos', 6),
  ('sales-rehidratacion',     'Electrolitos orales', 'Polvo',          'Sobre con 27.9 g',            'Oral', 'Rehidratación', 6),
  ('ambroxol-jarabe-15',      'Ambroxol',       'Jarabe',              'Frasco de 120 mL con 15 mg/5 mL', 'Oral', 'Mucolíticos', 6),
  ('dextrometorfano-jarabe',  'Dextrometorfano', 'Jarabe',             'Frasco de 120 mL con 15 mg/5 mL', 'Oral', 'Antitusivos', 6),
  ('vitamina-c-tab-500',      'Ácido ascórbico', 'Tableta',            'Caja con 20 tabletas de 500 mg', 'Oral', 'Vitaminas y minerales', 6)
ON CONFLICT (clave) DO NOTHING;
