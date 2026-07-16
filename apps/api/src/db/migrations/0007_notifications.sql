-- ═══════════════════════════════════════════════════════════════════
-- Notificaciones in-app (campanita): recordatorio de cita próxima,
-- check-in de paciente, cita cancelada, falla de timbrado.
-- Mismo patrón RLS que facturas (0006_billing.sql).
--
-- Índice único parcial: a lo sumo UNA notificación 'cita_proxima' por cita.
-- El scan de recordatorios corre en cada GET /notifications (sin cron; ver
-- plan) y puede correr en paralelo desde dos pestañas — el índice + el
-- ON CONFLICT ... DO NOTHING del INSERT cierran esa carrera.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS notifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES appointments(id) ON DELETE CASCADE,
  tipo           text NOT NULL
                 CHECK (tipo IN ('cita_proxima','cita_cancelada','checkin','factura_error')),
  titulo         text NOT NULL,
  mensaje        text NOT NULL,
  leida_at       timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_cita_proxima_uq
  ON notifications(appointment_id) WHERE tipo = 'cita_proxima';

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON notifications
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
