-- ═══════════════════════════════════════════════════════════════════
-- Recordatorios de cita por WhatsApp.
--
-- El paciente que no se presenta es la pérdida más cara del consultorio: la
-- hora ya está apartada y no se puede revender. Un aviso el día anterior con
-- tres botones (confirmar / cancelar / reagendar) convierte parte de esos
-- huecos en citas que sí ocurren o en horarios que se liberan a tiempo.
--
-- Dos cosas de este archivo se salen del molde habitual del repo, y ambas
-- tienen su porqué:
--
-- 1. UN ÍNDICE SIN tenant_id AL FRENTE (whatsapp_outbox_pendientes_idx).
--    La regla de 0021 existe porque RLS inyecta `tenant_id =
--    current_tenant_id()` en toda query. La cola de envío NO se barre bajo
--    RLS: la barre whatsapp_reclamar_pendientes(), una función SECURITY
--    DEFINER, donde ese predicado no se inyecta y no hay tenant que poner
--    primero. Un índice encabezado por tenant_id ahí no tendría igualdad que
--    lo abriera y el planificador acabaría en seq scan. NO "corregir" este
--    índice en una futura migración de rendimiento: mataría el barrido.
--
-- 2. FUNCIONES SECURITY DEFINER QUE SOLO DEVUELVEN IDENTIFICADORES.
--    El scheduler corre fuera de toda petición HTTP, así que no hay tenant
--    fijado. En vez de darle una conexión sin RLS —que convertiría cualquier
--    WHERE olvidado en una fuga entre clínicas— se le dan pares
--    (tenant_id, id) y nada más. Con ese tenant abre runInTenant() y lee los
--    datos reales YA bajo RLS, con el mismo WITH CHECK que una petición
--    normal. Mismo patrón que stripe_tenant_by_customer (0020).
--
-- Los filtros de "a quién NO se le manda" viven en el JOIN de esas funciones,
-- no en un if de TypeScript: si alguien edita el caso de uso y borra una
-- condición, la base sigue sin entregar la fila.
-- ═══════════════════════════════════════════════════════════════════

-- ── Configuración por clínica ────────────────────────────────────
-- El piloto sale con UN número compartido de HealthFlow, pero el remitente se
-- modela por tenant desde el día uno: migrar una clínica a número propio debe
-- ser un UPDATE, no un refactor.
CREATE TABLE IF NOT EXISTS tenant_whatsapp_config (
  tenant_id            uuid PRIMARY KEY DEFAULT current_tenant_id()
                       REFERENCES tenants(id) ON DELETE CASCADE,
  modo                 text NOT NULL DEFAULT 'compartido'
                       CHECK (modo IN ('compartido', 'propio')),
  waba_id              text,
  phone_number_id      text,
  -- AES-256-GCM con AAD = tenant_id (common/crypto/secreto-cifrado.ts). El
  -- AAD ata el ciphertext a la clínica: una fila copiada a otro tenant no
  -- descifra. NULL en modo compartido.
  access_token_cifrado text,
  -- Va como VARIABLE en el cuerpo de la plantilla, no como remitente: con el
  -- número compartido el remitente dice "HealthFlow" para todas.
  nombre_remitente     text,
  activo               boolean NOT NULL DEFAULT false,
  horas_anticipacion   int NOT NULL DEFAULT 24
                       CHECK (horas_anticipacion BETWEEN 1 AND 168),
  -- A partir del 1-oct-2026 Meta cobra también los mensajes de servicio, así
  -- que el "✅ Cita confirmada" deja de ser gratis y pasa a ser ~40% de la
  -- factura. Por eso es un interruptor por clínica y no una constante.
  enviar_confirmacion  boolean NOT NULL DEFAULT true,
  -- "Las 9 de la noche" es una hora LOCAL. Un servidor en UTC que use la hora
  -- del proceso mandaría mensajes a las 3 de la mañana en Tijuana.
  zona_horaria         text NOT NULL DEFAULT 'America/Mexico_City',
  silencio_desde       int NOT NULL DEFAULT 21 CHECK (silencio_desde BETWEEN 0 AND 23),
  silencio_hasta       int NOT NULL DEFAULT 8  CHECK (silencio_hasta BETWEEN 0 AND 23),
  -- Horario en que se pueden ofrecer huecos al reagendar. Mínimo viable: no
  -- modela vacaciones ni comidas ni horarios por médico.
  horario_atencion     jsonb NOT NULL
                       DEFAULT '{"dias":[1,2,3,4,5],"desde":"09:00","hasta":"18:00"}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- Una config a medias es peor que ninguna: el scheduler la intentaría usar
  -- en cada barrido y fallaría en silencio. Se prohíbe en la base, no solo
  -- en el DTO, porque el DTO no cubre un UPDATE hecho a mano.
  CONSTRAINT whatsapp_config_propio_completo CHECK (
    modo <> 'propio'
    OR (phone_number_id IS NOT NULL AND access_token_cifrado IS NOT NULL)
  )
);

ALTER TABLE tenant_whatsapp_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_whatsapp_config FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'tenant_whatsapp_config' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON tenant_whatsapp_config
      USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

-- ── Cola de salida ───────────────────────────────────────────────
-- Existe para que un fallo de red no pierda NI DUPLIQUE un mensaje. Cada fila
-- es la intención de mandar algo; el estado dice hasta dónde llegó.
CREATE TABLE IF NOT EXISTS whatsapp_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT current_tenant_id()
                  REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id      uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id  uuid REFERENCES appointments(id) ON DELETE CASCADE,
  plantilla       text NOT NULL CHECK (plantilla IN
                    ('recordatorio_cita', 'confirmacion_cita', 'cancelacion_cita')),
  variables       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 'enviando' no estaba en el diseño original y es imprescindible: se marca
  -- ANTES de llamar a Meta y se confirma después, porque la llamada HTTP no
  -- puede ocurrir dentro de la transacción (mantendría una conexión del pool
  -- ocupada durante segundos). Ver whatsapp_reclamar_pendientes().
  estado          text NOT NULL DEFAULT 'pendiente' CHECK (estado IN
                    ('pendiente', 'enviando', 'enviado', 'entregado', 'leido', 'fallido')),
  -- LLAVE DE RUTEO DEL INBOUND. Cuando el paciente pulsa un botón, Meta manda
  -- el id del mensaje al que responde; ese id resuelve tenant y cita. Nunca se
  -- rutea por teléfono: un mismo celular puede ser paciente en dos clínicas y
  -- resolver por número sería una fuga entre tenants que se salta el RLS.
  meta_message_id text,
  programado_para timestamptz NOT NULL,
  reclamado_at    timestamptz,
  enviado_at      timestamptz,
  intentos        int NOT NULL DEFAULT 0,
  ultimo_error    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- LA idempotencia. Un paciente nunca debe recibir dos veces el mismo aviso de
-- la misma cita, aunque el barrido se solape o el proceso muera a la mitad.
-- Lo decide la base, no el código. A diferencia de notifications_cita_proxima_uq
-- (0007) la clave incluye la plantilla, así que sí admite varias ventanas
-- (24h y 2h) sobre una misma cita el día que se quieran.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_outbox_cita_plantilla_uq
  ON whatsapp_outbox (appointment_id, plantilla)
  WHERE appointment_id IS NOT NULL;

-- Ver punto 1 de la cabecera: SIN tenant_id al frente, a propósito.
-- Parcial: indexa la cola viva, no el histórico ya enviado, que crece sin fin.
CREATE INDEX IF NOT EXISTS whatsapp_outbox_pendientes_idx
  ON whatsapp_outbox (programado_para)
  WHERE estado IN ('pendiente', 'enviando');

-- Ruteo del webhook: también cross-tenant y también dentro de una función
-- definer, misma justificación. UNIQUE porque Meta no repite ids.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_outbox_meta_message_uq
  ON whatsapp_outbox (meta_message_id)
  WHERE meta_message_id IS NOT NULL;

-- Estos dos SÍ empiezan por tenant_id: los consumen la pantalla de ajustes y
-- la agregación de costos por mes, que corren bajo RLS como todo lo demás.
CREATE INDEX IF NOT EXISTS whatsapp_outbox_tenant_creado_idx
  ON whatsapp_outbox (tenant_id, created_at DESC);

ALTER TABLE whatsapp_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_outbox FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'whatsapp_outbox' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON whatsapp_outbox
      USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

-- ── Tokens de reagendado ─────────────────────────────────────────
-- El botón "Reagendar" no se puede resolver dentro de WhatsApp (caben tres
-- botones y no hay calendario), así que manda a una página web. El paciente
-- no tiene cuenta: el link lleva un token de un solo uso. Mismo molde que
-- password_reset_tokens (0017): en la base solo el hash.
CREATE TABLE IF NOT EXISTS whatsapp_reagenda_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT current_tenant_id()
                 REFERENCES tenants(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  token_hash     text NOT NULL UNIQUE,
  expires_at     timestamptz NOT NULL,
  consumed_at    timestamptz,
  -- Tope de consultas: un token no debe servir de oráculo para sondear citas.
  intentos       int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_reagenda_tokens_tenant_idx
  ON whatsapp_reagenda_tokens (tenant_id, appointment_id);

ALTER TABLE whatsapp_reagenda_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_reagenda_tokens FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'whatsapp_reagenda_tokens' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON whatsapp_reagenda_tokens
      USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

-- ── Eventos entrantes de Meta ────────────────────────────────────
-- Global, sin tenant_id y sin RLS: cuando el evento llega todavía no se sabe
-- de qué clínica es. Molde de stripe_events (0009/0020).
--
-- Justo POR ESO no guarda el payload: el JSON de Meta trae teléfonos de
-- pacientes y no puede vivir en una tabla sin aislamiento. Aquí solo va el
-- hash del cuerpo, que es lo único que hace falta para no procesar dos veces
-- el mismo evento cuando Meta reintenta.
--
-- processed_at nullable por la lección de 0020: si se marcara como visto ANTES
-- de procesar y el handler fallara, el reintento de Meta se ignoraría y el
-- evento se perdería para siempre. El handler borra su propia marca al fallar.
CREATE TABLE IF NOT EXISTS whatsapp_events (
  id           text PRIMARY KEY,             -- sha256 hex del cuerpo crudo
  tipo         text NOT NULL,                -- 'status' | 'message' | 'otro'
  recibido_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  intentos     int NOT NULL DEFAULT 0,
  ultimo_error text
);

CREATE INDEX IF NOT EXISTS whatsapp_events_pendientes_idx
  ON whatsapp_events (recibido_at)
  WHERE processed_at IS NULL;

-- ── Pacientes: canal de contacto y consentimiento ────────────────
-- telefono (0000) es texto libre y contiene de todo: '555-123', extensiones,
-- números de familiares. Se conserva INTACTO como dato histórico visible y NO
-- se backfillea a telefono_e164: normalizar a ciegas un campo libre puede
-- producir el número de un tercero, y mandarle un WhatsApp a alguien que
-- nunca dio su consentimiento es exactamente lo que la LFPDPPP prohíbe.
-- El opt-in se captura siempre de forma explícita, con su fecha.
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS telefono_e164      text,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in_at timestamptz;

CREATE INDEX IF NOT EXISTS patients_tenant_e164_idx
  ON patients (tenant_id, telefono_e164)
  WHERE telefono_e164 IS NOT NULL;

-- ── Citas: confirmación del paciente ─────────────────────────────
-- Un TIMESTAMP, no un estatus nuevo. ALLOWED_TRANSITIONS (appointment.entity.ts)
-- no admite agendada → agendada, y meter un estado 'confirmada' obligaría a
-- tocar cada transición, el calendario y la sala de espera. Confirmar es un
-- hecho ortogonal al ciclo de vida de la cita, así que se modela aparte.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmada_at timestamptz;

-- ═══════════════════════════════════════════════════════════════════
-- Funciones del scheduler y del webhook. Todas SECURITY DEFINER, todas
-- devuelven identificadores y nada más. Ver punto 2 de la cabecera.
-- ═══════════════════════════════════════════════════════════════════

-- Clínicas con los recordatorios encendidos. Un uuid por fila, nada más.
CREATE OR REPLACE FUNCTION whatsapp_tenants_activos()
  RETURNS TABLE (tenant_id uuid)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT c.tenant_id
    FROM tenant_whatsapp_config c
    JOIN tenants t ON t.id = c.tenant_id
   WHERE c.activo
     -- Estados de suscripción terminales: replican la parte SIN reloj de
     -- debeRestringir() (common/subscription/debe-restringir.ts), que es la
     -- fuente de verdad. La gracia de past_due, que sí depende de la hora, la
     -- evalúa esa función en TypeScript antes de enviar. Una clínica que dejó
     -- de pagar no debe seguir generando mensajes facturables.
     AND t.subscription_status NOT IN ('canceled', 'unpaid', 'incomplete_expired', 'paused')
$$;

REVOKE ALL ON FUNCTION whatsapp_tenants_activos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_tenants_activos() TO healthflow_app;

-- Reclama un lote de la cola: lo marca 'enviando' y devuelve (id, tenant_id).
--
-- El claim se confirma ANTES de hablar con Meta, y el resultado se escribe
-- después en otra transacción. Es lo que evita tener una conexión del pool
-- abierta durante el round-trip a graph.facebook.com.
--
-- FOR UPDATE SKIP LOCKED para que dos barridos concurrentes se repartan el
-- trabajo en vez de bloquearse. El advisory lock es de TRANSACCIÓN, no de
-- sesión: se libera solo al commit, así que un proceso que muera aquí no deja
-- el lock colgado esperando a que alguien lo suelte a mano.
CREATE OR REPLACE FUNCTION whatsapp_reclamar_pendientes(p_limite int)
  RETURNS TABLE (outbox_id uuid, tenant_id uuid)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('whatsapp_outbox_despacho')) THEN
    RETURN;  -- otra instancia está barriendo: este tick no hace nada
  END IF;

  RETURN QUERY
  WITH candidatas AS (
    SELECT o.id
      FROM whatsapp_outbox o
      JOIN tenant_whatsapp_config c ON c.tenant_id = o.tenant_id AND c.activo
      JOIN tenants t ON t.id = o.tenant_id
      -- Los filtros de "a quién no se le manda" van aquí y no en TypeScript:
      -- consentimiento vigente, número enviable y cita todavía viva.
      JOIN patients p ON p.id = o.patient_id
                     AND p.whatsapp_opt_in
                     AND p.telefono_e164 IS NOT NULL
      LEFT JOIN appointments a ON a.id = o.appointment_id
     WHERE o.estado = 'pendiente'
       AND o.programado_para <= now()
       AND t.subscription_status NOT IN ('canceled', 'unpaid', 'incomplete_expired', 'paused')
       AND (a.id IS NULL OR a.estatus = 'agendada')
     ORDER BY o.programado_para
     LIMIT p_limite
     FOR UPDATE OF o SKIP LOCKED
  )
  UPDATE whatsapp_outbox o
     SET estado = 'enviando',
         reclamado_at = now(),
         intentos = o.intentos + 1
    FROM candidatas
   WHERE o.id = candidatas.id
  RETURNING o.id, o.tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION whatsapp_reclamar_pendientes(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_reclamar_pendientes(int) TO healthflow_app;

-- Devuelve a la cola las filas que quedaron colgadas en 'enviando'.
--
-- NO vuelven a 'pendiente': pasan a 'fallido' con resultado indeterminado. Si
-- el proceso murió entre el POST a Meta y la escritura del resultado, no hay
-- forma de saber si el mensaje se entregó — Cloud API no acepta clave de
-- idempotencia. Reintentar a ciegas mandaría el recordatorio dos veces, y un
-- paciente que recibe el mismo aviso duplicado deja de confiar en el canal
-- (además de que la clínica lo paga dos veces). Perder un mensaje es el mal
-- menor, y queda contado en la agregación de costos.
CREATE OR REPLACE FUNCTION whatsapp_cerrar_huerfanos(p_minutos int)
  RETURNS int
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_filas int;
BEGIN
  UPDATE whatsapp_outbox
     SET estado = 'fallido',
         ultimo_error = 'resultado_indeterminado: el proceso murió tras reclamar el envío'
   WHERE estado = 'enviando'
     AND reclamado_at < now() - make_interval(mins => p_minutos);
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RETURN v_filas;
END;
$$;

REVOKE ALL ON FUNCTION whatsapp_cerrar_huerfanos(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_cerrar_huerfanos(int) TO healthflow_app;

-- Ruteo del inbound: del id de mensaje de Meta al par (tenant, fila).
-- La ÚNICA forma admitida de resolver a qué clínica pertenece una respuesta.
CREATE OR REPLACE FUNCTION whatsapp_ruta_por_message_id(p_message_id text)
  RETURNS TABLE (tenant_id uuid, outbox_id uuid)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT o.tenant_id, o.id
    FROM whatsapp_outbox o
   WHERE o.meta_message_id = p_message_id
$$;

REVOKE ALL ON FUNCTION whatsapp_ruta_por_message_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_ruta_por_message_id(text) TO healthflow_app;

-- Resuelve el token de reagendado SIN consumirlo (para pintar la página) y de
-- paso cuenta el intento. El navegador del paciente no conoce ningún tenant.
CREATE OR REPLACE FUNCTION whatsapp_reagenda_resolver(p_token_hash text)
  RETURNS TABLE (status text, tenant_id uuid, appointment_id uuid)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_token whatsapp_reagenda_tokens%ROWTYPE;
BEGIN
  SELECT * INTO v_token FROM whatsapp_reagenda_tokens t WHERE t.token_hash = p_token_hash;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalido'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  UPDATE whatsapp_reagenda_tokens SET intentos = intentos + 1 WHERE id = v_token.id;

  IF v_token.consumed_at IS NOT NULL OR v_token.expires_at <= now() OR v_token.intentos >= 10 THEN
    RETURN QUERY SELECT 'expirado'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'ok'::text, v_token.tenant_id, v_token.appointment_id;
END;
$$;

REVOKE ALL ON FUNCTION whatsapp_reagenda_resolver(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_reagenda_resolver(text) TO healthflow_app;

-- Consume el token en la MISMA llamada que lo valida: sin ventana entre
-- "leer si sirve" y "marcarlo usado", que es por donde se cuela un doble
-- reagendado con dos pestañas abiertas. Mismo criterio que
-- redeem_password_reset_token (0017).
CREATE OR REPLACE FUNCTION whatsapp_reagenda_consumir(p_token_hash text)
  RETURNS TABLE (status text, tenant_id uuid, appointment_id uuid)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_token whatsapp_reagenda_tokens%ROWTYPE;
BEGIN
  SELECT * INTO v_token
    FROM whatsapp_reagenda_tokens t
   WHERE t.token_hash = p_token_hash
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalido'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  IF v_token.consumed_at IS NOT NULL OR v_token.expires_at <= now() THEN
    RETURN QUERY SELECT 'expirado'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  UPDATE whatsapp_reagenda_tokens SET consumed_at = now() WHERE id = v_token.id;

  RETURN QUERY SELECT 'ok'::text, v_token.tenant_id, v_token.appointment_id;
END;
$$;

REVOKE ALL ON FUNCTION whatsapp_reagenda_consumir(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_reagenda_consumir(text) TO healthflow_app;
