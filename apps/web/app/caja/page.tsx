'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MovimientoCajaView, TurnoCajaView } from '@healthflow/shared-types';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { AppShell } from '../../components/app-shell';
import { pesos } from '../../components/presupuesto-panel';
import { CorteResumen, TablaMovimientos, fechaHora, hora } from '../../components/caja-corte';
import {
  AbrirCajaModal,
  CancelarMovimientoModal,
  CerrarCajaModal,
  CorteModal,
  MovimientoCajaModal,
} from '../../components/caja-modales';
import { IconCash } from '../../components/icons';

/**
 * Caja del consultorio. Un turno abierto a la vez: se abre en la mañana con un
 * fondo de cambio, se van registrando cobros y salidas durante el día, y al
 * cerrar se cuenta el efectivo y sale el corte.
 *
 * Es tesorería, no cobranza: lo que el paciente DEBE vive en Presupuestos y lo
 * fiscal en Facturación. Un cobro ligado a un presupuesto alimenta a los dos.
 */
export default function CajaPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { token, user, ready } = useAuth();

  useEffect(() => {
    if (ready && !token) router.replace('/login');
  }, [ready, token, router]);

  const [abriendo, setAbriendo] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [capturando, setCapturando] = useState(false);
  const [editando, setEditando] = useState<MovimientoCajaView | null>(null);
  const [cancelando, setCancelando] = useState<MovimientoCajaView | null>(null);
  const [corteAbierto, setCorteAbierto] = useState<string | null>(null);

  const caja = useQuery({
    queryKey: ['caja-abierta'],
    queryFn: () => api.cajaAbierta(token!),
    enabled: !!token,
  });

  const cortes = useQuery({
    queryKey: ['caja-cortes'],
    queryFn: () => api.listarCortes(token!),
    enabled: !!token,
  });

  /** Tras cualquier cambio: el turno y el histórico pueden haberse movido. */
  const refrescar = (turno: TurnoCajaView) => {
    queryClient.setQueryData(['caja-abierta'], turno.abierta ? turno : null);
    void queryClient.invalidateQueries({ queryKey: ['caja-cortes'] });
    // Un cobro ligado a un presupuesto también movió el saldo del paciente.
    void queryClient.invalidateQueries({ queryKey: ['saldos'] });
    void queryClient.invalidateQueries({ queryKey: ['presupuestos-todos'] });
  };

  if (!ready || !token || !user) return null;

  const turno = caja.data ?? null;
  // Cancelar un movimiento es control interno: quien cobra no lo borra.
  const puedeCancelar = user.rol === 'medico' || user.rol === 'admin';
  const historico = (cortes.data ?? []).filter((c) => !c.abierta);

  return (
    <AppShell>
      <div className="p-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Caja</h1>
            {/* Con la caja abierta, quién y desde cuándo va aquí y no en un
                banner aparte: es contexto del encabezado, no un aviso. */}
            <p className="text-sm text-slate-500">
              {turno
                ? `Abierta desde las ${hora(turno.abiertaEn)} por ${turno.abiertaPorNombre}.`
                : 'El dinero que entra y sale del consultorio hoy, y el corte al cerrar el día.'}
            </p>
          </div>
          {turno && (
            <div className="flex gap-2">
              <button
                onClick={() => setCapturando(true)}
                className="rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95"
              >
                + Registrar movimiento
              </button>
              <button
                onClick={() => setCerrando(true)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-400"
              >
                Cerrar caja
              </button>
            </div>
          )}
        </div>

        {caja.isLoading && <p className="text-slate-400">Cargando caja…</p>}

        {!caja.isLoading && !turno && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400">
              <IconCash size={26} />
            </div>
            <h2 className="text-lg font-semibold">La caja está cerrada</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              Ábrela con el fondo de cambio del cajón para empezar a registrar los cobros del día.
            </p>
            <button
              onClick={() => setAbriendo(true)}
              className="mt-5 rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-95"
            >
              Abrir caja
            </button>
          </div>
        )}

        {turno && (
          <div className="space-y-5">
            <CorteResumen resumen={turno.resumen} />

            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
                Movimientos del turno
              </h2>
              <TablaMovimientos
                movimientos={turno.movimientos}
                acciones={(m) => (
                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => setEditando(m)}
                      className="text-xs font-medium text-brand-blue hover:underline"
                    >
                      Corregir
                    </button>
                    {puedeCancelar && (
                      <button
                        onClick={() => setCancelando(m)}
                        className="text-xs font-medium text-rose-600 hover:underline"
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                )}
              />
            </div>
          </div>
        )}

        <div className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Cortes anteriores
          </h2>

          {historico.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
              Todavía no hay cortes cerrados.
            </p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                      <th className="px-6 py-3 font-medium">Turno</th>
                      <th className="px-6 py-3 font-medium">Abrió / Cerró</th>
                      <th className="px-6 py-3 text-right font-medium">Ingresos</th>
                      <th className="px-6 py-3 text-right font-medium">Salidas</th>
                      <th className="px-6 py-3 text-right font-medium">Esperado</th>
                      <th className="px-6 py-3 text-right font-medium">Contado</th>
                      <th className="px-6 py-3 text-right font-medium">Diferencia</th>
                      <th className="px-6 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {historico.map((c) => {
                      const dif = c.resumen.diferenciaCentavos ?? 0;
                      return (
                        <tr key={c.id} className="hover:bg-slate-50">
                          <td className="whitespace-nowrap px-6 py-3">
                            {fechaHora(c.abiertaEn)}
                            {c.cerradaEn && (
                              <span className="text-slate-400"> → {hora(c.cerradaEn)}</span>
                            )}
                          </td>
                          <td className="px-6 py-3 text-slate-500">
                            {c.abiertaPorNombre}
                            {c.cerradaPorNombre && c.cerradaPorNombre !== c.abiertaPorNombre
                              ? ` / ${c.cerradaPorNombre}`
                              : ''}
                          </td>
                          <td className="whitespace-nowrap px-6 py-3 text-right tabular-nums text-emerald-700">
                            {pesos(c.resumen.ingresosCentavos)}
                          </td>
                          <td className="whitespace-nowrap px-6 py-3 text-right tabular-nums text-slate-500">
                            {pesos(c.resumen.egresosCentavos + c.resumen.retirosCentavos)}
                          </td>
                          <td className="whitespace-nowrap px-6 py-3 text-right tabular-nums">
                            {pesos(c.resumen.efectivoEsperadoCentavos)}
                          </td>
                          <td className="whitespace-nowrap px-6 py-3 text-right tabular-nums">
                            {pesos(c.resumen.efectivoContadoCentavos ?? 0)}
                          </td>
                          <td
                            className={`whitespace-nowrap px-6 py-3 text-right font-semibold tabular-nums ${
                              dif === 0 ? 'text-slate-400' : dif < 0 ? 'text-rose-600' : 'text-amber-600'
                            }`}
                          >
                            {dif > 0 ? '+' : ''}
                            {pesos(dif)}
                          </td>
                          <td className="whitespace-nowrap px-6 py-3 text-right">
                            <button
                              onClick={() => setCorteAbierto(c.id)}
                              className="text-xs font-medium text-brand-blue hover:underline"
                            >
                              Ver corte →
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {abriendo && (
        <AbrirCajaModal token={token} onClose={() => setAbriendo(false)} onAbierta={refrescar} />
      )}
      {capturando && (
        <MovimientoCajaModal
          token={token}
          onClose={() => setCapturando(false)}
          onGuardado={refrescar}
        />
      )}
      {editando && (
        <MovimientoCajaModal
          token={token}
          movimiento={editando}
          onClose={() => setEditando(null)}
          onGuardado={refrescar}
        />
      )}
      {cancelando && (
        <CancelarMovimientoModal
          token={token}
          movimiento={cancelando}
          onClose={() => setCancelando(null)}
          onCancelado={refrescar}
        />
      )}
      {cerrando && turno && (
        <CerrarCajaModal
          token={token}
          turno={turno}
          onClose={() => setCerrando(false)}
          onCerrada={(t) => {
            refrescar(t);
            // Al cerrar, el corte recién firmado es justo lo que se quiere ver.
            setCorteAbierto(t.id);
          }}
        />
      )}
      {corteAbierto && (
        <CorteModal token={token} turnoId={corteAbierto} onClose={() => setCorteAbierto(null)} />
      )}
    </AppShell>
  );
}
