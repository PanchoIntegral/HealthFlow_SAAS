-- El worker puede enviar avisos de citas históricas creadas antes de que la
-- agenda interna guardara enlaces públicos. Esta función limitada sólo llena
-- el hash si falta; no expone ni permite leer datos de la cita.
CREATE OR REPLACE FUNCTION ensure_public_appointment_manage_token(
  p_appointment_id uuid,
  p_token_hash text
) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=public AS $$
  UPDATE appointments
     SET public_manage_token_hash = p_token_hash,
         manage_token_expires_at = fin_programado + interval '24 hours'
   WHERE id = p_appointment_id
     AND public_manage_token_hash IS NULL
$$;

GRANT EXECUTE ON FUNCTION ensure_public_appointment_manage_token(uuid,text) TO healthflow_app;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='healthflow_worker') THEN
    GRANT EXECUTE ON FUNCTION ensure_public_appointment_manage_token(uuid,text) TO healthflow_worker;
  END IF;
END $$;
