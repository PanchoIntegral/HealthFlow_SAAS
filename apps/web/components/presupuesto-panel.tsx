'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  METODOS_PAGO,
  type EstatusPresupuesto,
  type MetodoPago,
  type NuevaPartida,
  type PresupuestoView,
} from '@healthflow/shared-types';
import { api, ApiError } from '../lib/api';

/** Centavos → "$1,200.00". Todo el dinero viaja en centavos enteros. */
export const pesos = (centavos: number) =>
  (centavos / 100).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

export const ETIQUETA_ESTATUS: Record<EstatusPresupuesto, string> = {
  borrador: 'Borrador',
  presentado: 'Presentado al paciente',
  aceptado: 'Aceptado',
  rechazado: 'Rechazado',
  terminado: 'Terminado',
  cancelado: 'Cancelado',
};

export const COLOR_ESTATUS: Record<EstatusPresupuesto, string> = {
  borrador: 'bg-slate-100 text-slate-700',
  presentado: 'bg-amber-100 text-amber-800',
  aceptado: 'bg-emerald-100 text-emerald-800',
  rechazado: 'bg-red-100 text-red-800',
  terminado: 'bg-blue-100 text-blue-800',
  cancelado: 'bg-slate-200 text-slate-500',
};

/** Transiciones que se ofrecen desde cada estatus (el backend es la autoridad). */
const SIGUIENTES: Record<EstatusPresupuesto, EstatusPresupuesto[]> = {
  borrador: ['presentado', 'cancelado'],
  presentado: ['aceptado', 'rechazado', 'borrador'],
  aceptado: ['terminado', 'cancelado'],
  rechazado: ['borrador'],
  terminado: [],
  cancelado: [],
};

export function PresupuestoPanel({
  token,
  patientId,
  /** Piezas preseleccionadas al crear, p.ej. desde un hallazgo del odontograma. */
  piezasSugeridas,
}: {
  token: string;
  patientId: string;
  piezasSugeridas?: string[];
}) {
  const queryClient = useQueryClient();
  const [creando, setCreando] = useState(false);

  const lista = useQuery({
    queryKey: ['presupuestos', patientId],
    queryFn: () => api.listarPresupuestos(token, patientId),
  });

  const refrescar = () => {
    void queryClient.invalidateQueries({ queryKey: ['presupuestos', patientId] });
    // El tablero de finanzas lee los mismos saldos.
    void queryClient.invalidateQueries({ queryKey: ['saldos'] });
  };

  const crear = useMutation({
    mutationFn: (partidas: NuevaPartida[]) =>
      api.crearPresupuesto(token, { patientId, titulo: 'Plan de tratamiento', partidas }),
    onSuccess: () => {
      refrescar();
      setCreando(false);
    },
  });

  if (lista.isLoading) return <p className="text-sm text-slate-400">Cargando presupuestos…</p>;

  const presupuestos = lista.data ?? [];

  return (
    <div className="space-y-4">
      {presupuestos.map((p) => (
        <Presupuesto key={p.id} token={token} presupuesto={p} onCambio={refrescar} />
      ))}

      {presupuestos.length === 0 && !creando && (
        <p className="text-sm text-slate-400">Sin presupuestos.</p>
      )}

      {creando ? (
        <EditorPartidas
          piezasIniciales={piezasSugeridas}
          guardando={crear.isPending}
          onGuardar={(partidas) => crear.mutate(partidas)}
          onCancelar={() => setCreando(false)}
        />
      ) : (
        <button
          onClick={() => setCreando(true)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:border-slate-400"
        >
          + Nuevo presupuesto
        </button>
      )}
    </div>
  );
}

function Presupuesto({
  token,
  presupuesto: p,
  onCambio,
}: {
  token: string;
  presupuesto: PresupuestoView;
  onCambio: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alFallar = (e: unknown) =>
    setError(e instanceof ApiError ? e.message : 'No se pudo completar la operación');

  const cambiarEstatus = useMutation({
    mutationFn: (estatus: EstatusPresupuesto) =>
      api.cambiarEstatusPresupuesto(token, p.id, estatus),
    onSuccess: () => {
      setError(null);
      onCambio();
    },
    onError: alFallar,
  });

  const editarPartidas = useMutation({
    mutationFn: (partidas: NuevaPartida[]) => api.reemplazarPartidas(token, p.id, partidas),
    onSuccess: () => {
      setError(null);
      setEditando(false);
      onCambio();
    },
    onError: alFallar,
  });

  const abonar = useMutation({
    mutationFn: (body: { montoCentavos: number; metodo: MetodoPago; referencia?: string }) =>
      api.registrarAbono(token, p.id, body),
    onSuccess: () => {
      setError(null);
      onCambio();
    },
    onError: alFallar,
  });

  const congelado = ['aceptado', 'terminado', 'cancelado'].includes(p.estatus);
  const fases = [...new Set(p.partidas.map((x) => x.fase))].sort((a, b) => a - b);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">{p.titulo}</h3>
          <span className={`inline-block rounded-md px-2 py-0.5 text-xs ${COLOR_ESTATUS[p.estatus]}`}>
            {ETIQUETA_ESTATUS[p.estatus]}
          </span>
        </div>
        <div className="flex gap-1.5">
          {SIGUIENTES[p.estatus].map((s) => (
            <button
              key={s}
              onClick={() => cambiarEstatus.mutate(s)}
              disabled={cambiarEstatus.isPending}
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:border-slate-400 disabled:opacity-50"
            >
              {ETIQUETA_ESTATUS[s]}
            </button>
          ))}
        </div>
      </div>

      {editando ? (
        <EditorPartidas
          partidasIniciales={p.partidas.map((x) => ({
            descripcion: x.descripcion,
            piezas: x.piezas,
            fase: x.fase,
            cantidad: x.cantidad,
            valorUnitarioCentavos: x.valorUnitarioCentavos,
          }))}
          guardando={editarPartidas.isPending}
          onGuardar={(partidas) => editarPartidas.mutate(partidas)}
          onCancelar={() => setEditando(false)}
        />
      ) : (
        <>
          {fases.map((fase) => (
            <div key={fase} className="mb-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Fase {fase}
              </p>
              <ul className="space-y-1">
                {p.partidas
                  .filter((x) => x.fase === fase)
                  .map((x) => (
                    <li
                      key={x.id}
                      className={`flex items-center justify-between gap-3 text-sm ${
                        x.estatus === 'cancelada' ? 'text-slate-400 line-through' : ''
                      }`}
                    >
                      <span>
                        {x.descripcion}
                        {x.piezas.length > 0 && (
                          <span className="ml-1.5 text-xs text-slate-500">
                            piezas {x.piezas.join(', ')}
                          </span>
                        )}
                        {x.estatus === 'terminado' && (
                          <span className="ml-1.5 text-xs text-emerald-700">✓ terminado</span>
                        )}
                      </span>
                      <span className="shrink-0 tabular-nums">{pesos(x.importeCentavos)}</span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}

          {!congelado && (
            <button
              onClick={() => setEditando(true)}
              className="mb-3 text-xs font-medium text-slate-600 underline hover:text-slate-900"
            >
              Editar partidas
            </button>
          )}
        </>
      )}

      {/* Totales. El saldo es el número que el dentista y el paciente miran. */}
      <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm">
        <Renglon etiqueta="Total" valor={pesos(p.totalCentavos)} />
        <Renglon etiqueta="Abonado" valor={pesos(p.abonadoCentavos)} />
        <Renglon etiqueta="Saldo" valor={pesos(p.saldoCentavos)} destacado />
      </div>

      {p.abonos.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {p.abonos.map((a) => (
            <li key={a.id} className="text-xs text-slate-500">
              {a.fecha} · {a.metodo} · {pesos(a.montoCentavos)}
              {a.referencia && ` · ${a.referencia}`}
            </li>
          ))}
        </ul>
      )}

      {p.estatus === 'aceptado' && p.saldoCentavos > 0 && (
        <FormAbono
          saldoCentavos={p.saldoCentavos}
          guardando={abonar.isPending}
          onAbonar={(body) => abonar.mutate(body)}
        />
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}

function Renglon({
  etiqueta,
  valor,
  destacado,
}: {
  etiqueta: string;
  valor: string;
  destacado?: boolean;
}) {
  return (
    <div className={`flex justify-between ${destacado ? 'font-semibold' : 'text-slate-600'}`}>
      <span>{etiqueta}</span>
      <span className="tabular-nums">{valor}</span>
    </div>
  );
}

function FormAbono({
  saldoCentavos,
  guardando,
  onAbonar,
}: {
  saldoCentavos: number;
  guardando: boolean;
  onAbonar: (b: { montoCentavos: number; metodo: MetodoPago; referencia?: string }) => void;
}) {
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState<MetodoPago>('efectivo');
  const [referencia, setReferencia] = useState('');

  const enviar = () => {
    // El usuario captura PESOS; el contrato es en centavos. La conversión vive
    // solo aquí, en el borde, igual que en el resto del sistema.
    const centavos = Math.round(Number(monto) * 100);
    if (!Number.isFinite(centavos) || centavos <= 0) return;
    onAbonar({ montoCentavos: centavos, metodo, referencia: referencia || undefined });
    setMonto('');
    setReferencia('');
  };

  const input = 'rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue';

  return (
    <div className="mt-3 rounded-lg bg-slate-50 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Registrar abono
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && enviar()}
          type="number"
          step="0.01"
          placeholder={`Máx. ${(saldoCentavos / 100).toFixed(2)}`}
          className={`${input} w-32`}
        />
        <select
          value={metodo}
          onChange={(e) => setMetodo(e.target.value as MetodoPago)}
          className={input}
        >
          {METODOS_PAGO.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          value={referencia}
          onChange={(e) => setReferencia(e.target.value)}
          placeholder="Referencia (opcional)"
          className={`${input} flex-1`}
        />
        <button
          onClick={enviar}
          disabled={guardando}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {guardando ? 'Guardando…' : 'Abonar'}
        </button>
      </div>
    </div>
  );
}

/** Alta y edición de partidas. Los precios se capturan en pesos. */
export function EditorPartidas({
  partidasIniciales,
  piezasIniciales,
  guardando,
  onGuardar,
  onCancelar,
  labelGuardar = 'Guardar',
  labelGuardando = 'Guardando…',
}: {
  partidasIniciales?: NuevaPartida[];
  piezasIniciales?: string[];
  guardando: boolean;
  onGuardar: (p: NuevaPartida[]) => void;
  onCancelar: () => void;
  labelGuardar?: string;
  labelGuardando?: string;
}) {
  const [partidas, setPartidas] = useState<NuevaPartida[]>(
    partidasIniciales ?? [
      {
        descripcion: '',
        piezas: piezasIniciales ?? [],
        fase: 1,
        cantidad: 1,
        valorUnitarioCentavos: 0,
      },
    ],
  );

  const actualizar = (i: number, cambio: Partial<NuevaPartida>) =>
    setPartidas((ps) => ps.map((p, j) => (j === i ? { ...p, ...cambio } : p)));

  const total = partidas.reduce(
    (s, p) => s + Math.round(p.cantidad * p.valorUnitarioCentavos),
    0,
  );

  const input = 'rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand-blue';

  return (
    <div className="space-y-2">
      {/* Encabezados: solo visibles en pantallas donde el grid ya no envuelve,
          para que quede claro qué captura cada casilla sin depender del title. */}
      <div className="hidden gap-2 px-0.5 text-xs font-medium text-slate-400 sm:grid sm:grid-cols-[1fr_90px_60px_70px_110px_auto]">
        <span>Tratamiento</span>
        <span>Piezas</span>
        <span>Fase</span>
        <span>Cant.</span>
        <span>Precio unit.</span>
        <span />
      </div>
      {partidas.map((p, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[1fr_90px_60px_70px_110px_auto]">
          <input
            value={p.descripcion}
            onChange={(e) => actualizar(i, { descripcion: e.target.value })}
            placeholder="Tratamiento (resina, endodoncia…)"
            className={input}
          />
          <input
            value={(p.piezas ?? []).join(', ')}
            onChange={(e) =>
              actualizar(i, {
                piezas: e.target.value
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean),
              })
            }
            placeholder="16, 26"
            className={input}
            title="Piezas en notación FDI"
          />
          <input
            type="number"
            min={1}
            value={p.fase ?? 1}
            onChange={(e) => actualizar(i, { fase: Number(e.target.value) })}
            className={input}
            title="Fase del tratamiento"
          />
          <input
            type="number"
            min={0.01}
            step={0.5}
            value={p.cantidad}
            onChange={(e) => actualizar(i, { cantidad: Number(e.target.value) })}
            className={input}
            title="Cantidad"
          />
          <input
            type="number"
            min={0}
            step="0.01"
            value={p.valorUnitarioCentavos / 100}
            onChange={(e) =>
              actualizar(i, { valorUnitarioCentavos: Math.round(Number(e.target.value) * 100) })
            }
            className={input}
            title="Precio unitario"
          />
          <button
            onClick={() => setPartidas((ps) => ps.filter((_, j) => j !== i))}
            disabled={partidas.length === 1}
            className="text-slate-400 hover:text-red-600 disabled:opacity-30"
            aria-label="Quitar partida"
          >
            ✕
          </button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          onClick={() =>
            setPartidas((ps) => [
              ...ps,
              { descripcion: '', piezas: [], fase: 1, cantidad: 1, valorUnitarioCentavos: 0 },
            ])
          }
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:border-slate-400"
        >
          + Partida
        </button>
        <span className="ml-auto text-sm font-semibold tabular-nums">Total {pesos(total)}</span>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onGuardar(partidas.filter((p) => p.descripcion.trim()))}
          disabled={guardando || !partidas.some((p) => p.descripcion.trim())}
          className="rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {guardando ? labelGuardando : labelGuardar}
        </button>
        <button onClick={onCancelar} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
          Cancelar
        </button>
      </div>
    </div>
  );
}
