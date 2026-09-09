-- La reserva pública deja de ser exclusiva del plan Consultorio: el plan
-- Individual también puede publicar agenda y aparecer en el directorio. El
-- plan `free` sigue fuera.
--
-- La lista de planes estaba copiada en cuatro lugares (0035, 0039, 0040 y una
-- constante de TypeScript) y ya había divergido de los planes reales del
-- producto —'clinica' y 'pro' son valores heredados; los vigentes son
-- 'individual' y 'consultorio'—. Se centraliza aquí para que el próximo cambio
-- de planes sea un solo lugar.
CREATE OR REPLACE FUNCTION public_booking_plans()
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT ARRAY['individual','consultorio','clinica','pro']
$$;

REVOKE ALL ON FUNCTION public_booking_plans() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_booking_plans() TO healthflow_app;

-- Reemplaza el filtro de plan de 0035. El resto de la función es idéntico.
CREATE OR REPLACE FUNCTION resolve_public_booking_tenant(p_slug text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT bs.tenant_id
    FROM booking_settings bs JOIN tenants t ON t.id = bs.tenant_id
   WHERE bs.slug = lower(p_slug) AND bs.publicado AND bs.feature_activa
     AND t.plan = ANY(public_booking_plans())
     AND (t.subscription_status IN ('active','trialing') OR
          (t.subscription_status = 'past_due' AND t.grace_until > now()) OR
          (t.subscription_status = 'none' AND current_setting('app.allow_unpaid_public_booking', true) = 'on'))
   LIMIT 1
$$;

-- Reemplaza el filtro de plan de 0040. El resto de la función es idéntico.
CREATE OR REPLACE FUNCTION search_public_booking_directory(
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
       AND t.plan = ANY(public_booking_plans())
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

-- Reemplaza el filtro de plan de 0040. El resto de la función es idéntico.
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
       AND t.plan = ANY(public_booking_plans())
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
