-- ═══════════════════════════════════════════════════════════════════
-- Caja (corte de caja del consultorio).
--
-- Registra el dinero que entra y sale del cajón de recepción a lo largo del
-- día: se ABRE un turno con un fondo inicial, se van registrando cobros y
-- salidas, y al final del día se CIERRA contando el efectivo. La diferencia
-- entre lo contado y lo esperado es el descuadre, y es todo el punto del
-- módulo: sin turno no hay contra qué comparar.
--
-- Relación con lo que ya existía:
--   • `presupuesto_abonos` es COBRANZA por tratamiento (cuánto debe el
--     paciente). La caja es TESORERÍA (cuánto dinero hay en el cajón hoy).
--     Un cobro de caja ligado a un presupuesto genera además su abono, y se
--     guarda `abono_id` para que las dos vistas nunca se contradigan.
--   • `facturas` es el acto fiscal ante el SAT. Cobrar y facturar son cosas
--     distintas y a menudo ocurren en momentos distintos, por eso la caja no
--     depende de que exista un CFDI.
--
-- NO hay columnas de totales ni de efectivo esperado, a propósito: se derivan
-- de los movimientos en cada lectura. Mismo criterio que `presupuestos` y
-- `facturas` — un total almacenado que se desfasa, en un corte de caja, es
-- una acusación de robo contra alguien.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS caja_turnos (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  -- Quién abrió el turno. Se conserva aunque otro usuario lo cierre: el corte
  -- tiene que decir quién recibió el fondo y quién entregó el efectivo.
  abierta_por               uuid NOT NULL REFERENCES users(id),
  -- Dinero con el que arranca el cajón (cambio). En CENTAVOS enteros, misma
  -- convención que facturación y presupuestos.
  fondo_inicial_centavos    bigint NOT NULL CHECK (fondo_inicial_centavos >= 0),
  abierta_en                timestamptz NOT NULL DEFAULT now(),
  notas_apertura            text,
  cerrada_por               uuid REFERENCES users(id),
  cerrada_en                timestamptz,
  -- Efectivo físicamente contado al cierre. NULL mientras el turno sigue
  -- abierto; el descuadre = contado − esperado se calcula al leer.
  efectivo_contado_centavos bigint CHECK (efectivo_contado_centavos >= 0),
  notas_cierre              text,
  -- Un turno cerrado tiene SIEMPRE las tres columnas del cierre; uno abierto,
  -- ninguna. Sin esto un cierre a medias dejaría un corte imposible de leer.
  CONSTRAINT caja_turnos_cierre_completo CHECK (
    (cerrada_en IS NULL AND cerrada_por IS NULL AND efectivo_contado_centavos IS NULL)
    OR
    (cerrada_en IS NOT NULL AND cerrada_por IS NOT NULL AND efectivo_contado_centavos IS NOT NULL)
  )
);

-- UNA sola caja abierta por clínica. Es la regla central del módulo y vive en
-- la base y no solo en el código: dos turnos abiertos a la vez significan que
-- los cobros se reparten entre dos cortes y ninguno cuadra. El índice parcial
-- deja libres los turnos ya cerrados (todos los que quiera el histórico).
CREATE UNIQUE INDEX IF NOT EXISTS caja_turnos_abierta_uq
  ON caja_turnos(tenant_id) WHERE cerrada_en IS NULL;

CREATE INDEX IF NOT EXISTS caja_turnos_abierta_en_idx ON caja_turnos(abierta_en DESC);

CREATE TABLE IF NOT EXISTS caja_movimientos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  turno_id            uuid NOT NULL REFERENCES caja_turnos(id) ON DELETE CASCADE,
  -- ingreso = entra dinero (cobro de consulta o tratamiento)
  -- egreso  = gasto pagado desde el cajón (material, proveedor)
  -- retiro  = efectivo que se saca a bóveda/banco; no es gasto, pero sale del cajón
  tipo                text NOT NULL CHECK (tipo IN ('ingreso','egreso','retiro')),
  concepto            text NOT NULL,
  monto_centavos      bigint NOT NULL CHECK (monto_centavos > 0),
  metodo              text NOT NULL CHECK (metodo IN ('efectivo','tarjeta','transferencia','otro')),
  -- Un retiro es sacar billetes del cajón: no existe "retirar con tarjeta".
  CONSTRAINT caja_movimientos_retiro_efectivo CHECK (tipo <> 'retiro' OR metodo = 'efectivo'),
  -- Contexto opcional. Un cobro de mostrador puede no tener paciente (venta de
  -- un cepillo) y por eso nada de esto es obligatorio.
  patient_id          uuid REFERENCES patients(id) ON DELETE SET NULL,
  appointment_id      uuid REFERENCES appointments(id) ON DELETE SET NULL,
  presupuesto_id      uuid REFERENCES presupuestos(id) ON DELETE SET NULL,
  -- Abono generado en el presupuesto por este cobro. Es el amarre entre
  -- tesorería y cobranza: mientras exista, el movimiento ya no se puede
  -- modificar en monto ni cancelar desde aquí (ver caja.errors.ts).
  abono_id            uuid,
  referencia          text,
  registrado_por      uuid NOT NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Cancelación LÓGICA. Un movimiento equivocado no se borra: el corte de caja
  -- es un documento contable y tiene que poder explicar qué se capturó de más
  -- y quién lo canceló.
  cancelado_en        timestamptz,
  cancelado_por       uuid REFERENCES users(id),
  motivo_cancelacion  text,
  CONSTRAINT caja_movimientos_cancelacion_completa CHECK (
    (cancelado_en IS NULL AND cancelado_por IS NULL)
    OR
    (cancelado_en IS NOT NULL AND cancelado_por IS NOT NULL AND motivo_cancelacion IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS caja_movimientos_turno_idx ON caja_movimientos(turno_id);
CREATE INDEX IF NOT EXISTS caja_movimientos_paciente_idx ON caja_movimientos(patient_id)
  WHERE patient_id IS NOT NULL;

-- Aislamiento multi-tenant, mismo patrón que el resto del esquema.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['caja_turnos','caja_movimientos']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t
    );
  END LOOP;
END $$;

-- Sin DELETE: los movimientos se cancelan lógicamente y los turnos se cierran.
-- Que el permiso no exista hace imposible borrar historia de caja por error
-- desde la aplicación, igual que en `consentimientos`.
GRANT SELECT, INSERT, UPDATE ON caja_turnos, caja_movimientos TO healthflow_app;
