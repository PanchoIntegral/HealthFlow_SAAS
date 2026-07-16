'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { FacturaEstatus } from '@healthflow/shared-types';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { AppShell } from '../../components/app-shell';
import { BarChart } from '../../components/bar-chart';

const pesos = (v: string | number) =>
  Number(v).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });

const ESTATUS_CHIP: Record<FacturaEstatus, { label: string; cls: string }> = {
  TIMBRADA: { label: 'Timbrada', cls: 'bg-emerald-50 text-emerald-700' },
  CANCELADA: { label: 'Cancelada', cls: 'bg-slate-100 text-slate-500' },
  ERROR: { label: 'Error', cls: 'bg-red-50 text-red-600' },
  PENDIENTE: { label: 'Pendiente', cls: 'bg-amber-50 text-amber-700' },
};

/** Finanzas del consultorio — SOLO médico/admin (el API lo exige vía CASL). */
export default function FinanzasPage() {
  const router = useRouter();
  const { token, user, ready } = useAuth();

  const canView = ['medico', 'admin'].includes(user?.rol ?? '');

  useEffect(() => {
    if (ready && !token) router.replace('/login');
    // El asistente no tiene esta sección: si teclea la URL, fuera.
    if (ready && user && !canView) router.replace('/dashboard');
  }, [ready, token, user, canView, router]);

  const { data, isLoading } = useQuery({
    queryKey: ['finanzas'],
    queryFn: () => api.finanzas(token!),
    enabled: !!token && canView,
  });

  if (!ready || !token || !user || !canView) return null;

  return (
    <AppShell>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Finanzas</h1>
          <p className="text-sm text-slate-500">
            Ingresos por facturación — solo cuentan las facturas timbradas.
          </p>
        </div>

        {isLoading && <p className="text-slate-400">Cargando finanzas…</p>}

        {data && (
          <>
            {/* KPIs */}
            <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi title="Facturado este mes" value={pesos(data.facturadoMes)} />
              <Kpi title="Facturado este año" value={pesos(data.facturadoAnio)} />
              <Kpi title="Facturas del mes" value={String(data.facturasMes)} />
              <Kpi
                title="Canceladas este mes"
                value={String(data.canceladasMes)}
                accent={data.canceladasMes > 0 ? 'text-red-600' : undefined}
              />
            </div>

            {/* Ingresos por mes */}
            <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-1 font-semibold">Ingresos por mes</h2>
              <p className="mb-4 text-xs text-slate-400">Últimos 6 meses (facturas timbradas)</p>
              <BarChart
                data={data.ingresosPorMes.map((m) => ({
                  key: m.mes,
                  label: m.label,
                  total: m.total,
                }))}
                tooltipSuffix="MXN"
              />
            </div>

            {/* Listado de facturas */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <h2 className="border-b border-slate-100 px-6 py-4 font-semibold">Facturas</h2>
              {data.facturas.length === 0 ? (
                <p className="p-8 text-center text-sm text-slate-400">
                  Aún no hay facturas. Se emiten desde la sala de espera al finalizar una consulta.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                        <th className="px-6 py-3 font-medium">Fecha</th>
                        <th className="px-6 py-3 font-medium">Paciente</th>
                        <th className="px-6 py-3 font-medium">Folio fiscal</th>
                        <th className="px-6 py-3 font-medium">Estatus</th>
                        <th className="px-6 py-3 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {data.facturas.map((f) => {
                        const chip = ESTATUS_CHIP[f.estatus];
                        const cancelada = f.estatus === 'CANCELADA';
                        return (
                          <tr key={f.id} className={cancelada ? 'text-slate-400' : ''}>
                            <td className="whitespace-nowrap px-6 py-3">{fecha(f.fecha)}</td>
                            <td className="px-6 py-3 font-medium">{f.pacienteNombre}</td>
                            <td className="max-w-[180px] truncate px-6 py-3 font-mono text-xs text-slate-500" title={f.uuidFiscal ?? ''}>
                              {f.uuidFiscal ?? '—'}
                            </td>
                            <td className="px-6 py-3">
                              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${chip.cls}`}>
                                {chip.label}
                              </span>
                              {cancelada && f.motivoCancelacion && (
                                <span className="ml-1 text-xs">({f.motivoCancelacion})</span>
                              )}
                            </td>
                            <td className={`whitespace-nowrap px-6 py-3 text-right font-semibold ${cancelada ? 'line-through' : ''}`}>
                              {pesos(f.total)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Kpi({ title, value, accent }: { title: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{title}</p>
      <p className={`mt-1 text-3xl font-bold ${accent ?? ''}`}>{value}</p>
    </div>
  );
}
