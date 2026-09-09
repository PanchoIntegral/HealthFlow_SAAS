-- El directorio necesita dos cosas que 0039 no daba: filtrar por especialidad
-- y conocer el catálogo completo de especialidades publicadas. Lo segundo no
-- puede derivarse de una página de resultados (sólo vería 12 de N), así que
-- vive en su propia función de superficie mínima.

-- Se elimina la versión de tres argumentos de 0039 en lugar de conservarla:
-- coexistir con la de cuatro (donde p_specialty tiene DEFAULT) haría ambigua
-- la resolución de sobrecargas en llamadas de tres argumentos. La migración
-- corre en una transacción, así que el reemplazo es atómico; debe desplegarse
-- junto con el API, que ya pasa los cuatro argumentos.
DROP FUNCTION IF EXISTS search_public_booking_directory(text,int,int);

CREATE FUNCTION search_public_booking_directory(
  p_query text DEFAULT '',
  p_specialty text DEFAULT NULL,
  p_limit int DEFAULT 12,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  slug text,
  clinic_name text,
  clinic_address text,
  doctor_id uuid,
  doctor_name text,
  specialty text,
  total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH professionals AS (
    SELECT DISTINCT bs.slug, t.nombre_clinica, t.direccion, u.id,
           u.nombre, u.especialidad
      FROM booking_settings bs
      JOIN tenants t ON t.id = bs.tenant_id
      JOIN booking_services svc ON svc.tenant_id = bs.tenant_id
                            AND svc.activo AND svc.publico
      JOIN booking_service_doctors bsd ON bsd.service_id = svc.id
      JOIN users u ON u.id = bsd.doctor_id AND u.activo
     WHERE bs.publicado AND bs.directorio_publico AND bs.feature_activa
       AND t.plan IN ('consultorio','clinica','pro')
       AND (t.subscription_status IN ('active','trialing') OR
            (t.subscription_status = 'past_due' AND t.grace_until > now()) OR
            (t.subscription_status = 'none' AND
             current_setting('app.allow_unpaid_public_booking', true) = 'on'))
  ), matches AS (
    SELECT * FROM professionals p
     WHERE (btrim(coalesce(p_query,'')) = ''
        OR p.nombre_clinica ILIKE '%' || btrim(p_query) || '%'
        OR p.nombre ILIKE '%' || btrim(p_query) || '%'
        OR coalesce(p.especialidad,'') ILIKE '%' || btrim(p_query) || '%')
       AND (btrim(coalesce(p_specialty,'')) = ''
        OR lower(btrim(coalesce(p.especialidad,''))) = lower(btrim(p_specialty)))
  )
  SELECT m.slug, m.nombre_clinica, m.direccion, m.id, m.nombre,
         m.especialidad, count(*) OVER()
    FROM matches m
   ORDER BY m.nombre_clinica, m.nombre, m.id
   LIMIT greatest(1,least(coalesce(p_limit,12),24))
  OFFSET greatest(coalesce(p_offset,0),0)
$$;

-- Catálogo de especialidades publicadas, con cuántos profesionales tiene cada
-- una. Mismas reglas de visibilidad que el buscador: si una clínica no optó
-- por el directorio, su especialidad tampoco aparece.
CREATE OR REPLACE FUNCTION list_public_booking_specialties()
RETURNS TABLE (specialty text, total bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH professionals AS (
    SELECT DISTINCT bs.slug, u.id, btrim(u.especialidad) AS especialidad
      FROM booking_settings bs
      JOIN tenants t ON t.id = bs.tenant_id
      JOIN booking_services svc ON svc.tenant_id = bs.tenant_id
                            AND svc.activo AND svc.publico
      JOIN booking_service_doctors bsd ON bsd.service_id = svc.id
      JOIN users u ON u.id = bsd.doctor_id AND u.activo
     WHERE bs.publicado AND bs.directorio_publico AND bs.feature_activa
       AND t.plan IN ('consultorio','clinica','pro')
       AND (t.subscription_status IN ('active','trialing') OR
            (t.subscription_status = 'past_due' AND t.grace_until > now()) OR
            (t.subscription_status = 'none' AND
             current_setting('app.allow_unpaid_public_booking', true) = 'on'))
  )
  SELECT p.especialidad, count(*)
    FROM professionals p
   WHERE coalesce(p.especialidad,'') <> ''
   GROUP BY p.especialidad
   ORDER BY count(*) DESC, p.especialidad
   LIMIT 40
$$;

REVOKE ALL ON FUNCTION search_public_booking_directory(text,text,int,int) FROM PUBLIC;
REVOKE ALL ON FUNCTION list_public_booking_specialties() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_public_booking_directory(text,text,int,int) TO healthflow_app;
GRANT EXECUTE ON FUNCTION list_public_booking_specialties() TO healthflow_app;
