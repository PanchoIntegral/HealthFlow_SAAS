'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  MetodoPago,
  MovimientoCajaView,
  PatientSummary,
  TipoMovimientoCaja,
  TurnoCajaView,
} from '@healthflow/shared-types';
import { api, ApiError } from '../lib/api';
import { Modal } from './modal';
import { pesos } from './presupuesto-panel';
import { CorteResumen, ETIQUETA_METODO, ETIQUETA_TIPO, TablaMovimientos } from './caja-corte';

const METODOS: MetodoPago[] = ['efectivo', 'tarjeta', 'transferencia', 'otro'];
const TIPOS: TipoMovimientoCaja[] = ['ingreso', 'egreso', 'retiro'];

/**
 * El usuario captura PESOS y la API habla en CENTAVOS. La conversión se hace
 * aquí, en el borde, con redondeo: `19.99 * 100` en coma flotante da
 * 1998.9999… y truncar convertiría un peso en 99 centavos.
 */
const aCentavos = (texto: string): number | null => {
  const n = Number(texto.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
};

const mensaje = (e: unknown, fallback: string) =>
  e instanceof ApiError ? e.message : fallback;

function CampoMonto({
  label,
  valor,
  onChange,
  autoFocus,
}: {
  label: string;
  valor: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
          $
        </span>
        <input
          autoFocus={autoFocus}
          inputMode="decimal"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.00"
          className="w-full rounded-lg border border-slate-300 py-2 pl-7 pr-3 text-sm tabular-nums outline-none focus:border-brand-blue"
        />
      </div>
    </label>
  );
}

/** Apertura del turno: lo único que se pide es el fondo de cambio. */
export function AbrirCajaModal({
  token,
  onClose,
  onAbierta,
}: {
  token: string;
  onClose: () => void;
  onAbierta: (t: TurnoCajaView) => void;
}) {
  const [fondo, setFondo] = useState('');
  const [notas, setNotas] = useState('');
  const [error, setError] = useState<string | null>(null);

  const abrir = useMutation({
    mutationFn: () =>
      api.abrirCaja(token, {
        fondoInicialCentavos: aCentavos(fondo) ?? 0,
        notas: notas.trim() || undefined,
      }),
    onSuccess: (t) => {
      onAbierta(t);
      onClose();
    },
    onError: (e) => setError(mensaje(e, 'No se pudo abrir la caja')),
  });

  return (
    <Modal
      titulo="Abrir caja"
      subtitulo="Cuenta el dinero con el que arranca el cajón; contra eso se hará el corte."
      onClose={onClose}
    >
      <div className="space-y-4">
        <CampoMonto autoFocus label="Fondo inicial (cambio)" valor={fondo} onChange={setFondo} />
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Notas (opcional)</span>
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <BotonSecundario onClick={onClose}>Cancelar</BotonSecundario>
          <BotonPrimario
            disabled={abrir.isPending || aCentavos(fondo) === null}
            onClick={() => {
              setError(null);
              abrir.mutate();
            }}
          >
            {abrir.isPending ? 'Abriendo…' : 'Abrir caja'}
          </BotonPrimario>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Alta y corrección de movimientos. Con `movimiento` edita el existente; sin
 * él captura uno nuevo. Al editar solo se muestran los campos que el backend
 * deja cambiar: el tipo y el vínculo con el paciente ya no se tocan.
 */
export function MovimientoCajaModal({
  token,
  movimiento,
  onClose,
  onGuardado,
}: {
  token: string;
  movimiento?: MovimientoCajaView;
  onClose: () => void;
  onGuardado: (t: TurnoCajaView) => void;
}) {
  const editando = !!movimiento;
  const [tipo, setTipo] = useState<TipoMovimientoCaja>(movimiento?.tipo ?? 'ingreso');
  const [concepto, setConcepto] = useState(movimiento?.concepto ?? '');
  const [monto, setMonto] = useState(
    movimiento ? (movimiento.montoCentavos / 100).toFixed(2) : '',
  );
  const [metodo, setMetodo] = useState<MetodoPago>(movimiento?.metodo ?? 'efectivo');
  const [referencia, setReferencia] = useState(movimiento?.referencia ?? '');
  const [paciente, setPaciente] = useState<{ id: string; nombre: string } | null>(null);
  const [presupuestoId, setPresupuestoId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Un cobro ya aplicado a un presupuesto tiene el monto congelado: el abono
  // del paciente no se puede reescribir (lo rechaza el backend igual).
  const montoBloqueado = editando && !!movimiento?.abonoId;

  const guardar = useMutation({
    mutationFn: () => {
      const montoCentavos = aCentavos(monto) ?? 0;
      if (movimiento) {
        return api.actualizarMovimientoCaja(token, movimiento.id, {
          concepto: concepto.trim(),
          referencia: referencia.trim() || undefined,
          ...(montoBloqueado ? {} : { montoCentavos, metodo }),
        });
      }
      return api.registrarMovimientoCaja(token, {
        tipo,
        concepto: concepto.trim(),
        montoCentavos,
        metodo,
        patientId: paciente?.id,
        presupuestoId: presupuestoId || undefined,
        referencia: referencia.trim() || undefined,
      });
    },
    onSuccess: (t) => {
      onGuardado(t);
      onClose();
    },
    onError: (e) => setError(mensaje(e, 'No se pudo guardar el movimiento')),
  });

  const centavos = aCentavos(monto);
  const listo = concepto.trim().length > 0 && centavos !== null && centavos > 0;

  return (
    <Modal
      titulo={editando ? 'Corregir movimiento' : 'Registrar movimiento'}
      subtitulo={
        editando
          ? 'Solo corrección de captura: el tipo no cambia. Si el movimiento no debió existir, cancélalo.'
          : undefined
      }
      onClose={onClose}
      ancho="max-w-lg"
    >
      <div className="space-y-4">
        {!editando && (
          <div className="flex gap-2">
            {TIPOS.map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTipo(t);
                  // Un retiro es sacar billetes del cajón: no hay otro método.
                  if (t === 'retiro') setMetodo('efectivo');
                }}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  tipo === t
                    ? 'bg-brand-blue text-white'
                    : 'border border-slate-300 text-slate-600 hover:border-slate-400'
                }`}
              >
                {ETIQUETA_TIPO[t]}
              </button>
            ))}
          </div>
        )}

        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Concepto</span>
          <input
            autoFocus={editando}
            value={concepto}
            onChange={(e) => setConcepto(e.target.value)}
            placeholder={
              tipo === 'ingreso'
                ? 'Consulta, limpieza, abono…'
                : tipo === 'egreso'
                  ? 'Material, proveedor…'
                  : 'Depósito bancario, a bóveda…'
            }
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <CampoMonto label="Monto" valor={monto} onChange={setMonto} autoFocus={!editando} />
            {montoBloqueado && (
              <p className="mt-1 text-xs text-slate-400">
                Este cobro ya se aplicó como abono a un presupuesto: el monto no se puede cambiar.
              </p>
            )}
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">Método de pago</span>
            <select
              value={metodo}
              disabled={tipo === 'retiro' || montoBloqueado}
              onChange={(e) => setMetodo(e.target.value as MetodoPago)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue disabled:bg-slate-50 disabled:text-slate-400"
            >
              {METODOS.map((m) => (
                <option key={m} value={m}>
                  {ETIQUETA_METODO[m]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Ligar a paciente y presupuesto solo tiene sentido al cobrar algo nuevo. */}
        {!editando && tipo === 'ingreso' && (
          <LigarPaciente
            token={token}
            paciente={paciente}
            presupuestoId={presupuestoId}
            onPaciente={(p) => {
              setPaciente(p);
              setPresupuestoId('');
            }}
            onPresupuesto={setPresupuestoId}
            onConcepto={setConcepto}
            onMonto={setMonto}
          />
        )}

        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">
            Referencia (opcional)
          </span>
          <input
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            placeholder="Folio de terminal, número de recibo…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <BotonSecundario onClick={onClose}>Cancelar</BotonSecundario>
          <BotonPrimario
            disabled={!listo || guardar.isPending}
            onClick={() => {
              setError(null);
              guardar.mutate();
            }}
          >
            {guardar.isPending ? 'Guardando…' : editando ? 'Guardar cambios' : 'Registrar'}
          </BotonPrimario>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Buscador de paciente y, si el paciente tiene tratamientos con saldo, el
 * presupuesto al que se aplica el cobro. Elegir uno hace que el cobro genere
 * también su abono, así que se muestra el saldo para no cobrar de más.
 */
function LigarPaciente({
  token,
  paciente,
  presupuestoId,
  onPaciente,
  onPresupuesto,
  onConcepto,
  onMonto,
}: {
  token: string;
  paciente: { id: string; nombre: string } | null;
  presupuestoId: string;
  onPaciente: (p: { id: string; nombre: string } | null) => void;
  onPresupuesto: (id: string) => void;
  onConcepto: (c: string) => void;
  onMonto: (m: string) => void;
}) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const busqueda = useQuery({
    queryKey: ['pacientes-buscar', debounced],
    queryFn: () => api.searchPatients(token, debounced),
    enabled: !paciente && q.trim().length > 0,
  });

  const presupuestos = useQuery({
    queryKey: ['presupuestos-paciente', paciente?.id],
    queryFn: () => api.listarPresupuestos(token, paciente!.id),
    enabled: !!paciente,
  });

  const conSaldo = useMemo(
    () => (presupuestos.data ?? []).filter((p) => p.estatus === 'aceptado' && p.saldoCentavos > 0),
    [presupuestos.data],
  );

  if (!paciente) {
    const resultados: PatientSummary[] = busqueda.data ?? [];
    return (
      <div>
        <span className="mb-1 block text-xs font-medium text-slate-500">Paciente (opcional)</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar paciente por nombre o CURP…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue"
        />
        {resultados.length > 0 && (
          <ul className="mt-2 max-h-40 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {resultados.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => {
                    onPaciente({ id: p.id, nombre: p.nombre });
                    setQ('');
                  }}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  {p.nombre}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{paciente.nombre}</span>
        <button
          onClick={() => onPaciente(null)}
          className="text-xs font-medium text-slate-500 hover:text-brand-blue"
        >
          Quitar
        </button>
      </div>

      {presupuestos.isLoading && <p className="mt-2 text-xs text-slate-400">Buscando saldos…</p>}

      {!presupuestos.isLoading && conSaldo.length === 0 && (
        <p className="mt-2 text-xs text-slate-400">
          Sin tratamientos aceptados con saldo. El cobro se registra suelto.
        </p>
      )}

      {conSaldo.length > 0 && (
        <label className="mt-2 block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">
            Aplicar a un tratamiento (registra el abono)
          </span>
          <select
            value={presupuestoId}
            onChange={(e) => {
              const id = e.target.value;
              onPresupuesto(id);
              const p = conSaldo.find((x) => x.id === id);
              // Prellenar con el saldo completo: lo más común es liquidar, y
              // si va a ser un abono parcial el usuario lo baja de un teclazo.
              if (p) {
                onConcepto(`Abono — ${p.titulo}`);
                onMonto((p.saldoCentavos / 100).toFixed(2));
              }
            }}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue"
          >
            <option value="">No aplicar a ninguno</option>
            {conSaldo.map((p) => (
              <option key={p.id} value={p.id}>
                {p.titulo} — saldo {pesos(p.saldoCentavos)}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

/** Cierre del turno: se cuenta el efectivo y se ve el descuadre al instante. */
export function CerrarCajaModal({
  token,
  turno,
  onClose,
  onCerrada,
}: {
  token: string;
  turno: TurnoCajaView;
  onClose: () => void;
  onCerrada: (t: TurnoCajaView) => void;
}) {
  const [contado, setContado] = useState('');
  const [notas, setNotas] = useState('');
  const [error, setError] = useState<string | null>(null);

  const centavos = aCentavos(contado);
  const esperado = turno.resumen.efectivoEsperadoCentavos;
  const diferencia = centavos === null ? null : centavos - esperado;

  const cerrar = useMutation({
    mutationFn: () =>
      api.cerrarCaja(token, {
        efectivoContadoCentavos: centavos ?? 0,
        notas: notas.trim() || undefined,
      }),
    onSuccess: (t) => {
      onCerrada(t);
      onClose();
    },
    onError: (e) => setError(mensaje(e, 'No se pudo cerrar la caja')),
  });

  return (
    <Modal
      titulo="Cerrar caja"
      subtitulo="Cuenta el efectivo del cajón y captúralo. El corte queda firmado y ya no admite cambios."
      onClose={onClose}
      ancho="max-w-lg"
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Efectivo esperado en el cajón</span>
            <span className="font-semibold tabular-nums">{pesos(esperado)}</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Fondo inicial + cobros en efectivo − gastos en efectivo − retiros.
          </p>
        </div>

        <CampoMonto autoFocus label="Efectivo contado" valor={contado} onChange={setContado} />

        {diferencia !== null && (
          <div
            className={`rounded-lg px-4 py-3 text-sm ${
              diferencia === 0
                ? 'bg-emerald-50 text-emerald-700'
                : diferencia < 0
                  ? 'bg-rose-50 text-rose-700'
                  : 'bg-amber-50 text-amber-700'
            }`}
          >
            {diferencia === 0 ? (
              <span className="font-medium">La caja cuadra.</span>
            ) : (
              <span>
                <span className="font-medium">
                  {diferencia < 0 ? 'Faltan' : 'Sobran'} {pesos(Math.abs(diferencia))}
                </span>{' '}
                respecto a lo esperado. Explícalo en las notas del cierre.
              </span>
            )}
          </div>
        )}

        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">
            Notas del cierre (opcional)
          </span>
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <BotonSecundario onClick={onClose}>Cancelar</BotonSecundario>
          <BotonPrimario
            disabled={centavos === null || cerrar.isPending}
            onClick={() => {
              setError(null);
              cerrar.mutate();
            }}
          >
            {cerrar.isPending ? 'Cerrando…' : 'Cerrar caja y generar corte'}
          </BotonPrimario>
        </div>
      </div>
    </Modal>
  );
}

/** Anulación de un movimiento. El motivo es obligatorio y queda en el corte. */
export function CancelarMovimientoModal({
  token,
  movimiento,
  onClose,
  onCancelado,
}: {
  token: string;
  movimiento: MovimientoCajaView;
  onClose: () => void;
  onCancelado: (t: TurnoCajaView) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const cancelar = useMutation({
    mutationFn: () => api.cancelarMovimientoCaja(token, movimiento.id, motivo.trim()),
    onSuccess: (t) => {
      onCancelado(t);
      onClose();
    },
    onError: (e) => setError(mensaje(e, 'No se pudo cancelar el movimiento')),
  });

  return (
    <Modal
      titulo="Cancelar movimiento"
      subtitulo={`${ETIQUETA_TIPO[movimiento.tipo]} de ${pesos(movimiento.montoCentavos)} — ${movimiento.concepto}`}
      onClose={onClose}
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          El movimiento no se borra: se queda en el corte marcado como cancelado, con tu nombre y el
          motivo.
        </p>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Motivo</span>
          <input
            autoFocus
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Se capturó dos veces, monto equivocado…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <BotonSecundario onClick={onClose}>Volver</BotonSecundario>
          <button
            disabled={motivo.trim().length === 0 || cancelar.isPending}
            onClick={() => {
              setError(null);
              cancelar.mutate();
            }}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
          >
            {cancelar.isPending ? 'Cancelando…' : 'Cancelar movimiento'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** El corte de un turno ya cerrado, en modal desde el histórico. */
export function CorteModal({
  token,
  turnoId,
  onClose,
}: {
  token: string;
  turnoId: string;
  onClose: () => void;
}) {
  const corte = useQuery({
    queryKey: ['corte-caja', turnoId],
    queryFn: () => api.corteDeCaja(token, turnoId),
  });

  return (
    <Modal
      titulo="Corte de caja"
      subtitulo={
        corte.data
          ? `Abrió ${corte.data.abiertaPorNombre} · Cerró ${corte.data.cerradaPorNombre ?? '—'}`
          : undefined
      }
      onClose={onClose}
      ancho="max-w-5xl"
    >
      {corte.isLoading && <p className="text-slate-400">Cargando corte…</p>}
      {corte.data && (
        <div className="space-y-5">
          <CorteResumen resumen={corte.data.resumen} />
          {corte.data.notasCierre && (
            <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <span className="font-medium">Notas del cierre: </span>
              {corte.data.notasCierre}
            </p>
          )}
          <TablaMovimientos movimientos={corte.data.movimientos} />
        </div>
      )}
    </Modal>
  );
}

function BotonPrimario({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function BotonSecundario({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-400"
    >
      {children}
    </button>
  );
}
