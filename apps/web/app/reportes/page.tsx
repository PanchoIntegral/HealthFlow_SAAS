'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { AppShell } from '../../components/app-shell';
import { BarChart } from '../../components/bar-chart';

export default function ReportesPage() {
  return (
    <AppShell>
      <ReportesContent />
    </AppShell>
  );
}

function ReportesContent() {
  const { token, user } = useAuth();

  const stats = useQuery({
    queryKey: ['reports-stats'],
    queryFn: () => api.reportsStats(token!),
    enabled: !!token,
  });

  if (!user) return null;

  const maxDiag = Math.max(1, ...(stats.data?.diagnosticosFrecuentes.map((d) => d.total) ?? [1]));

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Reportes</h1>
        <p className="text-sm text-slate-500">Estadísticas agregadas de la clínica</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Tendencia mensual */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-2">
          <div className="mb-6">
            <h2 className="font-semibold">Tendencia de citas</h2>
            <p className="text-xs text-slate-400">Últimos 6 meses</p>
          </div>
          <BarChart
            data={(stats.data?.tendenciaMensual ?? []).map((t) => ({ key: t.mes, label: t.label, total: t.total }))}
            tooltipSuffix="citas"
          />
        </section>

        {/* Diagnósticos más frecuentes */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="mb-4">
            <h2 className="font-semibold">Diagnósticos más frecuentes</h2>
            <p className="text-xs text-slate-400">Notas clínicas cerradas · CIE-10</p>
          </div>
          {stats.data && stats.data.diagnosticosFrecuentes.length > 0 ? (
            <ul className="space-y-3">
              {stats.data.diagnosticosFrecuentes.map((d) => (
                <li key={d.cie10}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium">
                      <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-500">
                        {d.cie10}
                      </span>
                      {d.descripcion}
                    </span>
                    <span className="text-slate-400">{d.total}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-brand-blue to-brand-teal"
                      style={{ width: `${Math.max(6, (d.total / maxDiag) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-slate-400">
              Aún no hay notas clínicas cerradas con diagnóstico.
            </p>
          )}
        </section>

        {/* Productividad por médico */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="mb-4">
            <h2 className="font-semibold">Productividad por médico</h2>
            <p className="text-xs text-slate-400">Últimos 90 días</p>
          </div>
          {stats.data && stats.data.productividadMedicos.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {stats.data.productividadMedicos.map((m) => (
                <li key={m.doctorId} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <div className="grid h-9 w-9 place-items-center rounded-full bg-brand-blue/10 text-xs font-semibold text-brand-blue">
                      {iniciales(m.doctorNombre)}
                    </div>
                    <span className="font-medium">{m.doctorNombre}</span>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-semibold">{m.consultas} consultas</p>
                    <p className="text-xs text-slate-400">
                      {m.tiempoPromedioMin != null ? `${m.tiempoPromedioMin} min prom.` : '—'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-slate-400">Sin consultas finalizadas en el periodo.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function iniciales(nombre: string): string {
  return nombre.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}
