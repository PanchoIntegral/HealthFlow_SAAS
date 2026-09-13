-- Una nota clínica cerrada es inmutable también para PostgreSQL.
--
-- Hasta ahora la inmutabilidad de NOM-004 vivía sólo en la entidad de dominio
-- (`ClinicalNote.assertEditable`). Eso no bastó: el autosave leía la nota,
-- comprobaba el estatus en memoria y luego hacía un UPDATE sin condición, así
-- que uno que leyera justo antes del cierre podía devolver la nota firmada a
-- 'borrador' con el contenido previo. El código ya está corregido; este
-- trigger garantiza que ningún bug futuro, ni una sentencia SQL directa con el
-- rol de aplicación, pueda repetirlo.
--
-- Qué se permite y qué no:
--   · borrador → cualquier cambio, incluido el cierre;
--   · cerrada  → ningún UPDATE que altere la fila (se compara la fila entera,
--                así una columna nueva queda protegida sin tocar el trigger);
--   · cerrada  → DELETE rechazado para los roles de la aplicación y el worker.
--
-- El DELETE se filtra por `session_user` y no por `current_user` a propósito:
-- un ON DELETE CASCADE corre con el dueño de la tabla como `current_user`,
-- pero `session_user` sigue siendo quien abrió la conexión. Así el rol de
-- aplicación tampoco puede borrar una nota firmada borrando a su paciente,
-- mientras que el rol admin (seed, limpieza de tests) sí puede retirar
-- clínicas de prueba completas.
--
-- Las correcciones siguen el camino de siempre: filas nuevas en
-- `notas_correccion` (0033), que ya es de sólo inserción.

CREATE FUNCTION clinical_notes_inmutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.estatus <> 'cerrada' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN
      RAISE EXCEPTION 'La nota clínica % está cerrada y es inmutable', OLD.id
        USING ERRCODE = '42501',
              HINT = 'Las correcciones se agregan en notas_correccion.';
    END IF;
    RETURN NEW;
  END IF;

  -- DELETE
  IF session_user IN ('healthflow_app', 'healthflow_worker') THEN
    RAISE EXCEPTION 'La nota clínica % está cerrada y no puede eliminarse', OLD.id
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER clinical_notes_inmutable
  BEFORE UPDATE OR DELETE ON clinical_notes
  FOR EACH ROW EXECUTE FUNCTION clinical_notes_inmutable();

-- TRUNCATE no dispara triggers de fila, y el privilegio TRIGGER permitiría
-- crear otros. Ninguno de los dos roles los tenía (0001 concede sólo DML),
-- pero se revocan explícitamente para que un GRANT ALL futuro no los abra.
-- Deshabilitar el trigger exige ser dueño de la tabla: ninguno de los dos lo es.
REVOKE TRUNCATE, TRIGGER ON clinical_notes FROM healthflow_app;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='healthflow_worker') THEN
  REVOKE TRUNCATE, TRIGGER ON clinical_notes FROM healthflow_worker;
END IF; END $$;
