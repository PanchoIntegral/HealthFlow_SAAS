-- ═══════════════════════════════════════════════════════════════════
-- Bloqueo progresivo de login (anti fuerza bruta / credential stuffing).
--
-- El rate limiting en memoria (@nestjs/throttler) se pierde en cada deploy y
-- no se comparte entre instancias; esta tabla es la memoria persistente del
-- intento fallido. Vive fuera del modelo multi-tenant, igual que
-- stripe_events: se consulta ANTES de saber quién es el usuario, así que no
-- puede depender de current_tenant_id() ni llevar RLS.
--
-- Se cuenta en dos ámbitos a la vez:
--   'email' → protege una cuenta concreta de que le adivinen la contraseña.
--   'ip'    → protege al sistema de un atacante que rocía muchas cuentas.
-- Ver login-policy.ts: el ámbito 'email' se bloquea poco tiempo a propósito
-- (bloquearlo mucho dejaría a un médico fuera de su agenda con solo teclear
-- su email 5 veces mal desde otro sitio), y el ámbito 'ip' es el severo.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS login_attempts (
  scope            text        NOT NULL CHECK (scope IN ('email', 'ip')),
  key              text        NOT NULL,
  attempts         integer     NOT NULL DEFAULT 0,
  first_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

-- Para la purga periódica de filas ya caducadas (ver login-attempts.service.ts):
-- sin ella, un ataque que rocíe millones de emails distintos deja basura
-- creciendo sin límite.
CREATE INDEX IF NOT EXISTS login_attempts_last_attempt_idx
  ON login_attempts (last_attempt_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON login_attempts TO healthflow_app;
