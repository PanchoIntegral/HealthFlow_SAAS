-- Notas clínicas v2: plantilla versionada, contexto de la nota y activación
-- gradual por clínica y especialidad.
--
-- ── 1. Columnas estampadas por el servidor ──
-- `especialidad`, `contexto_nota` y `plantilla_version` las escribe SÓLO el
-- inicio de consulta, al crear el borrador. También viajan dentro del jsonb
-- (la nota es autodescriptiva), pero la fuente de verdad es la columna: el
-- repositorio la impone sobre lo que diga el contenido.
--
-- NULL = nota legacy. Sin backfill, a propósito:
--   · Las notas CERRADAS no pueden recibirlo sin desactivar el trigger de
--     inmutabilidad (0052) sobre documentos firmados, y no hay nada que ganar:
--     su especialidad ya se lee de `contenido_nom004->>'especialidad'`.
--   · `contexto_nota` no se puede deducir de una nota vieja sin inferir; y
--     una nota sin plantilla versionada se interpreta como `legacy-v0`.
--   · Los borradores legacy se quedan legacy hasta cerrarse: cambiarles la
--     plantilla a media consulta cambiaría lo que se le exige al médico.
ALTER TABLE clinical_notes
  ADD COLUMN especialidad text,
  ADD COLUMN contexto_nota text
    CHECK (contexto_nota IN ('general', 'inicial_especialidad', 'seguimiento')),
  ADD COLUMN plantilla_version text
    CHECK (plantilla_version IN ('legacy-v0', 'v1'));

-- Una nota versionada nace completa: sin especialidad o contexto, el motor de
-- reglas no sabría qué exigirle.
ALTER TABLE clinical_notes
  ADD CONSTRAINT clinical_notes_v2_completa CHECK (
    plantilla_version IS NULL
    OR (especialidad IS NOT NULL AND contexto_nota IS NOT NULL)
  );

-- ── 2. Lo estampado no se reescribe ──
-- El trigger de 0052 ya congela la fila completa de una nota cerrada. Esto
-- cubre el borrador: una vez estampada la plantilla, ni un bug ni SQL directo
-- con el rol de aplicación pueden cambiar la especialidad o el contexto con
-- los que se decidió qué pedirle al médico.
CREATE FUNCTION clinical_notes_sello_v2() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.plantilla_version IS NOT NULL AND (
       NEW.plantilla_version IS DISTINCT FROM OLD.plantilla_version
    OR NEW.especialidad      IS DISTINCT FROM OLD.especialidad
    OR NEW.contexto_nota     IS DISTINCT FROM OLD.contexto_nota
    OR NEW.tipo_nota         IS DISTINCT FROM OLD.tipo_nota
  ) THEN
    RAISE EXCEPTION 'La plantilla y el contexto de la nota % no se pueden cambiar', OLD.id
      USING ERRCODE = '42501';
  END IF;
  -- Una nota legacy no se "sube" de plantilla después de creada.
  IF OLD.plantilla_version IS NULL AND NEW.plantilla_version IS NOT NULL THEN
    RAISE EXCEPTION 'La nota % se creó sin plantilla versionada', OLD.id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER clinical_notes_sello_v2
  BEFORE UPDATE ON clinical_notes
  FOR EACH ROW EXECUTE FUNCTION clinical_notes_sello_v2();

-- ── 3. Índice para decidir el contexto al iniciar consulta ──
-- "¿Tiene este expediente historia general cerrada? ¿Y valoración inicial en
-- esta especialidad?" Se consulta en cada inicio de consulta con el flag
-- encendido. La expresión cubre también las notas legacy, cuya especialidad
-- sólo vive en el jsonb.
CREATE INDEX clinical_notes_contexto_idx
  ON clinical_notes (
    clinical_record_id,
    (coalesce(especialidad, contenido_nom004->>'especialidad', 'general'))
  )
  WHERE estatus = 'cerrada';

-- ── 4. Activación gradual: notas_v2 por clínica y especialidad ──
-- No es un módulo comercial, así que no vive en `tenant_feature_flags`: ahí
-- entraría al catálogo de Ajustes y a los planes, y el titular podría
-- encenderlo solo. Activar reglas clínicas exige la aprobación
-- clínico-legal de la matriz, así que lo escribe HealthFlow con
-- `pnpm db:notas-v2` (rol admin) y la aplicación sólo lo lee.
--
-- Sin fila = apagado. Apagar vuelve legacy a las consultas NUEVAS; las notas
-- ya creadas con v1 conservan su plantilla, que es la que quedó estampada.
CREATE TABLE notas_v2_rollout (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
    DEFAULT current_tenant_id(),
  especialidad text NOT NULL CHECK (especialidad ~ '^[a-z][a-z_]{2,63}$'),
  habilitado boolean NOT NULL DEFAULT false,
  nota text,
  cambiado_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, especialidad)
);

ALTER TABLE notas_v2_rollout ENABLE ROW LEVEL SECURITY;
ALTER TABLE notas_v2_rollout FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notas_v2_rollout
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- 0001 concede DML por defecto sobre toda tabla nueva; aquí sólo lectura.
REVOKE ALL ON notas_v2_rollout FROM healthflow_app;
GRANT SELECT ON notas_v2_rollout TO healthflow_app;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='healthflow_worker') THEN
  REVOKE ALL ON notas_v2_rollout FROM healthflow_worker;
END IF; END $$;
