-- Login: única operación legítima que necesita leer `users` ANTES de conocer
-- el tenant. En vez de exponer una conexión superusuario en el código, se
-- encapsula en una función SECURITY DEFINER (corre como su dueño → bypassa RLS
-- de forma controlada), con search_path fijo y EXECUTE solo para el rol de app.
CREATE OR REPLACE FUNCTION auth_find_user_by_email(p_email text)
  RETURNS TABLE (id uuid, tenant_id uuid, password_hash text, nombre text, rol text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT id, tenant_id, password_hash, nombre, rol
    FROM users
   WHERE email = p_email
$$;

REVOKE ALL ON FUNCTION auth_find_user_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user_by_email(text) TO healthflow_app;
