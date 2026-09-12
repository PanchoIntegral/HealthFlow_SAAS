-- El worker no podía hacer su trabajo.
--
-- Los consumidores de Recall corren como `healthflow_worker`, pero la suite
-- que los probaba usaba la conexión de la aplicación. Con el rol real, CADA
-- consumidor fallaba en su primera escritura transversal —`permission denied
-- for table audit_log`— y tras ocho reintentos quedaba `dead`. El módulo no
-- habría funcionado en producción y el síntoma habría sido "no pasa nada".
--
-- Se conceden los permisos MÍNIMOS, no los cómodos.

-- ── 1. Auditoría del sistema: una función, no un GRANT ──
-- El primer intento fue conceder INSERT por columna
-- (tenant_id, user_id, entidad, entidad_id, accion, detalle). No sirve: Drizzle
-- nombra TODAS las columnas en el INSERT, incluidas `id` y `created_at` con el
-- literal `default`, y nombrar una columna exige privilegio sobre ella aunque
-- el valor sea el suyo por omisión. Habría que conceder también `created_at`,
-- es decir, permitir que el worker fabrique entradas de bitácora con fecha
-- falsificada. Eso no.
--
-- La función acota de verdad lo que el worker puede escribir:
--   · `user_id` va NULL SIEMPRE — el sistema no puede hacerse pasar por una
--     persona, y eso deja de ser una convención del código para ser una
--     garantía de la base;
--   · `id` y `created_at` los pone PostgreSQL;
--   · el tenant se comprueba contra el de la transacción, porque
--     SECURITY DEFINER salta RLS.
CREATE FUNCTION record_system_audit(
  p_tenant_id uuid, p_entidad text, p_entidad_id uuid, p_accion text, p_detalle jsonb
) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
    RAISE EXCEPTION 'audit tenant mismatch' USING ERRCODE = '42501';
  END IF;
  INSERT INTO audit_log (tenant_id, user_id, entidad, entidad_id, accion, detalle)
  VALUES (p_tenant_id, NULL, p_entidad, p_entidad_id, p_accion, p_detalle);
END $$;

REVOKE ALL ON FUNCTION record_system_audit(uuid, text, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_system_audit(uuid, text, uuid, text, jsonb) TO healthflow_app;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='healthflow_worker') THEN
  GRANT EXECUTE ON FUNCTION record_system_audit(uuid, text, uuid, text, jsonb) TO healthflow_worker;
END IF; END $$;

-- ── 2. Outbox: NO se concede UPDATE ──
-- Un UPDATE general sobre `outbound_messages` le daría al worker la capacidad
-- de reescribir el estado de cualquier mensaje —incluido marcar como enviado
-- algo que nunca salió, o revivir un cancelado por opt-out—. Lo único que los
-- consumidores necesitan es CANCELAR lo que aún no se entregó, así que eso es
-- lo único que se expone, y como operación con nombre.
--
-- SECURITY DEFINER salta RLS, de modo que el filtro por tenant va EXPLÍCITO en
-- cada consulta: sin él, un caller podría cancelar los mensajes de otra
-- clínica pasando un id ajeno.

/** Cancela lo que quedara en cola para UNA gestión concreta. */
CREATE FUNCTION cancel_recall_attempt_messages(p_recall_attempt_id uuid)
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_afectados int; BEGIN
  UPDATE outbound_messages om SET status='cancelled', updated_at=now()
   WHERE om.recall_attempt_id = p_recall_attempt_id
     AND om.tenant_id = current_tenant_id()
     -- Sólo lo que todavía no salió. Un mensaje entregado no se des-envía, y
     -- reescribir su estado falsearía las métricas de entrega.
     AND om.status IN ('pending','failed');
  GET DIAGNOSTICS v_afectados = ROW_COUNT;
  RETURN v_afectados;
END $$;

/** Cancela lo que quedara en cola para las gestiones abiertas de un control. */
CREATE FUNCTION cancel_recall_pending_messages(p_patient_recall_id uuid)
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_afectados int; BEGIN
  UPDATE outbound_messages om SET status='cancelled', updated_at=now()
   WHERE om.tenant_id = current_tenant_id()
     AND om.status IN ('pending','failed')
     AND om.recall_attempt_id IN (
       SELECT ra.id FROM recall_attempts ra
        WHERE ra.patient_recall_id = p_patient_recall_id
          AND ra.tenant_id = current_tenant_id()
          AND ra.status = 'pending'
     );
  GET DIAGNOSTICS v_afectados = ROW_COUNT;
  RETURN v_afectados;
END $$;

REVOKE ALL ON FUNCTION cancel_recall_attempt_messages(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION cancel_recall_pending_messages(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_recall_attempt_messages(uuid) TO healthflow_app;
GRANT EXECUTE ON FUNCTION cancel_recall_pending_messages(uuid) TO healthflow_app;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='healthflow_worker') THEN
  GRANT EXECUTE ON FUNCTION cancel_recall_attempt_messages(uuid) TO healthflow_worker;
  GRANT EXECUTE ON FUNCTION cancel_recall_pending_messages(uuid) TO healthflow_worker;
END IF; END $$;
