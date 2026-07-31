-- ═══════════════════════════════════════════════════════════════════
-- 1) Periodo de facturación del tenant.
--
-- El checkout ya elegía el Price correcto (mensual vs anual) y lo mandaba en
-- la metadata de la Checkout Session, pero `periodo` se perdía en el webhook:
-- el tenant quedaba idéntico a uno mensual. Se persiste para que la cuenta
-- refleje lo que realmente se cobró.
--
-- 2) `users.es_medico`: capacidad clínica, separada del ROL (permisos).
--
-- El dueño que compra la cuenta se provisiona con rol 'admin' (necesita
-- `manage all`), pero la lista de médicos para agendar filtraba por
-- rol = 'medico' — así que el médico que pagó nunca aparecía y, sin gestión
-- de personal todavía, la agenda quedaba inutilizable. El flag permite que
-- un admin sea también médico agendable sin degradar sus permisos.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE tenants
  ADD COLUMN billing_period text NOT NULL DEFAULT 'mensual'
    CHECK (billing_period IN ('mensual', 'anual'));

ALTER TABLE users
  ADD COLUMN es_medico boolean NOT NULL DEFAULT false;

-- Backfill: quien ya tiene rol 'medico' es médico agendable.
UPDATE users SET es_medico = true WHERE rol = 'medico';

-- Cuentas self-serve ya provisionadas: su único usuario es el dueño-médico.
UPDATE users u
   SET es_medico = true
  FROM tenants t
 WHERE u.tenant_id = t.id
   AND u.rol = 'admin'
   AND t.stripe_subscription_id IS NOT NULL;
