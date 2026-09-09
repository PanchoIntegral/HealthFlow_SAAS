-- El enlace de reserva y la aparición en el directorio son consentimientos
-- distintos: una clínica puede compartir su slug sin ser descubrible.
ALTER TABLE booking_settings
  ADD COLUMN IF NOT EXISTS directorio_publico boolean NOT NULL DEFAULT false;

-- Superficie cross-tenant mínima para el buscador público. Devuelve únicamente
-- datos que la clínica eligió publicar y nunca toca pacientes ni citas.
CREATE OR REPLACE FUNCTION search_public_booking_directory(
  p_query text DEFAULT '',
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
     WHERE btrim(coalesce(p_query,'')) = ''
        OR p.nombre_clinica ILIKE '%' || btrim(p_query) || '%'
        OR p.nombre ILIKE '%' || btrim(p_query) || '%'
        OR coalesce(p.especialidad,'') ILIKE '%' || btrim(p_query) || '%'
  )
  SELECT m.slug, m.nombre_clinica, m.direccion, m.id, m.nombre,
         m.especialidad, count(*) OVER()
    FROM matches m
   ORDER BY m.nombre_clinica, m.nombre, m.id
   LIMIT greatest(1,least(coalesce(p_limit,12),24))
  OFFSET greatest(coalesce(p_offset,0),0)
$$;

REVOKE ALL ON FUNCTION search_public_booking_directory(text,int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_public_booking_directory(text,int,int) TO healthflow_app;
