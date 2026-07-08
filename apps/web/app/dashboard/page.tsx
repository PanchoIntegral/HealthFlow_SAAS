'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CitasPorDia, WaitingRoomEntry } from '@healthflow/shared-types';
import { useAuth } from '../../lib/auth';
import { api, ApiError } from '../../lib/api';
import { useWaitingRoom, WAITING_ROOM_QUERY_KEY } from '../../lib/use-waiting-room';
import { AppShell } from '../../components/app-shell';
import { StatusBadge } from '../../components/status-badge';
import { IconBell, IconSearch } from '../../components/icons';

export default function DashboardPage() {
  return (
    <AppShell>
      <DashboardContent />
    </AppShell>
  );
}

function DashboardContent() {
  const router = useRouter();
  const { token, user } = useAuth();
  const queryClient = useQueryClient();

  const stats = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.dashboardStats(token!),
    enabled: !!token,
  });

  const { data: entries } = useWaitingRoom(token ?? '');

  const startConsultation = useMutation({
    mutationFn: (id: string) => api.startConsultation(token!, id),
    onSuccess: (res) => router.push(`/consulta/${res.appointmentId}?patientId=${res.patientId}`),
    onError: (err) => alert(err instanceof ApiError ? err.message : 'Error al iniciar consulta'),
  });

  const checkIn = useMutation({
    mutationFn: (id: string) => api.checkIn(token!, id),
    onSuccess: (updated) =>
      queryClient.setQueryData<WaitingRoomEntry[]>(WAITING_ROOM_QUERY_KEY, (prev) =>
        prev?.map((e) => (e.appointmentId === updated.appointmentId ? updated : e)),
      ),
  });

  const sala = (entries ?? []).filter((e) => e.estatus === 'en_espera' || e.estatus === 'en_consulta');
  const canConsult = user && ['medico', 'admin'].includes(user.rol);

  if (!user) return null;

  return (
    <div>
      {/* Barra superior */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-4">
        <div>
          <p className="text-sm capitalize text-slate-400">{hoyLargo()}</p>
          <h1 className="text-xl font-bold">{saludo()}, {user.nombre}</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative hidden md:block">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <IconSearch />
            </span>
            <input
              onKeyDown={(e) => e.key === 'Enter' && router.push('/pacientes')}
              placeholder="Buscar paciente o expediente…"
              className="w-72 rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-blue focus:bg-white"
            />
          </div>
          <button className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50">
            <IconBell />
          </button>
          <button
            onClick={() => router.push('/calendario')}
            className="rounded-xl bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-95"
          >
            + Nueva cita
          </button>
        </div>
      </header>

      <div className="p-8">
        {/* KPIs */}
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            titulo="Citas hoy"
            valor={stats.data?.citasHoy ?? '—'}
            sub={`${stats.data?.completadasHoy ?? 0} completadas · ${stats.data?.enEsperaHoy ?? 0} en espera`}
          />
          <StatCard
            titulo="Tiempo prom. consulta"
            valor={stats.data?.tiempoPromedioMin != null ? stats.data.tiempoPromedioMin : '—'}
            unidad="min"
            sub="últimos 30 días"
          />
          <StatCard
            titulo="Citas del mes"
            valor={stats.data?.citasDelMes ?? '—'}
            sub="mes en curso"
          />
          <StatCard
            titulo="Tasa de no-shows"
            valor={stats.data?.tasaNoShows ?? '—'}
            unidad="%"
            sub="mes en curso"
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-6">
            {/* Gráfica citas por día */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="mb-6">
                <h2 className="font-semibold">Citas por día</h2>
                <p className="text-xs text-slate-400">Últimos 7 días</p>
              </div>
              <BarChart data={stats.data?.citasPorDia ?? []} />
            </section>

            {/* Agenda de hoy */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold">Agenda de hoy</h2>
                <button onClick={() => router.push('/sala-de-espera')} className="text-sm font-medium text-brand-blue">
                  Ver sala →
                </button>
              </div>
              {entries && entries.length > 0 ? (
                <ul className="divide-y divide-slate-100">
                  {entries.map((e) => (
                    <li key={e.appointmentId} className="flex items-center gap-4 py-3">
                      <span className="w-14 text-sm font-mono text-slate-500">{hora(e.inicioProgramado)}</span>
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                        {inic(e.patientNombre)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{e.patientNombre}</p>
                        <p className="truncate text-xs text-slate-500">{e.motivo ?? '—'}</p>
                      </div>
                      <StatusBadge status={e.estatus} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-6 text-center text-sm text-slate-400">No hay citas para hoy.</p>
              )}
            </section>
          </div>

          {/* Panel sala de espera en vivo */}
          <aside className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                <h2 className="font-semibold">Sala de espera</h2>
              </div>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">En vivo</span>
            </div>

            {sala.length > 0 ? (
              <ul className="space-y-3">
                {sala.map((e) => (
                  <li key={e.appointmentId} className="rounded-xl border border-slate-200 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="grid h-9 w-9 place-items-center rounded-full bg-amber-100 text-xs font-semibold text-amber-700">
                          {inic(e.patientNombre)}
                        </div>
                        <div>
                          <p className="text-sm font-semibold leading-tight">{e.patientNombre}</p>
                          <p className="text-xs text-slate-500">{e.patientEdad} a · {e.motivo ?? '—'}</p>
                        </div>
                      </div>
                      <span className="text-xs font-medium text-amber-600">{espera(e.checkinAt)}</span>
                    </div>
                    {canConsult && (
                      <button
                        onClick={() => startConsultation.mutate(e.appointmentId)}
                        className={`w-full rounded-lg py-2 text-sm font-semibold transition ${
                          e.estatus === 'en_espera'
                            ? 'bg-gradient-to-r from-brand-blue to-brand-green text-white hover:opacity-95'
                            : 'border border-brand-blue text-brand-blue hover:bg-brand-blue/5'
                        }`}
                      >
                        {e.estatus === 'en_espera' ? 'Iniciar consulta' : 'Continuar consulta →'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-slate-400">Nadie en espera ahora.</p>
            )}

            {/* Agendadas hoy: acción rápida de check-in */}
            <PendientesCheckIn
              entries={entries ?? []}
              onCheckIn={(id) => checkIn.mutate(id)}
            />
          </aside>
        </div>
      </div>
    </div>
  );
}

function PendientesCheckIn({
  entries,
  onCheckIn,
}: {
  entries: WaitingRoomEntry[];
  onCheckIn: (id: string) => void;
}) {
  const agendadas = entries.filter((e) => e.estatus === 'agendada');
  if (agendadas.length === 0) return null;
  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Por llegar</p>
      <ul className="space-y-2">
        {agendadas.map((e) => (
          <li key={e.appointmentId} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">{e.patientNombre}</span>
            <button
              onClick={() => onCheckIn(e.appointmentId)}
              className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-brand-blue hover:text-brand-blue"
            >
              Marcar llegada
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatCard({
  titulo,
  valor,
  unidad,
  sub,
}: {
  titulo: string;
  valor: number | string;
  unidad?: string;
  sub: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="mb-2 text-sm text-slate-500">{titulo}</p>
      <p className="text-3xl font-bold">
        {valor}
        {unidad && <span className="ml-1 text-base font-medium text-slate-400">{unidad}</span>}
      </p>
      <p className="mt-1 text-xs text-slate-400">{sub}</p>
    </div>
  );
}

function BarChart({ data }: { data: CitasPorDia[] }) {
  const max = useMemo(() => Math.max(1, ...data.map((d) => d.total)), [data]);
  if (data.length === 0) {
    return <div className="h-40 animate-pulse rounded-xl bg-slate-50" />;
  }
  return (
    <div className="flex h-44 items-end justify-between gap-3">
      {data.map((d, i) => {
        const color = lerpColor('#2563EB', '#10B981', data.length > 1 ? i / (data.length - 1) : 0);
        const h = Math.max(6, (d.total / max) * 100);
        return (
          <div key={d.fecha} className="flex flex-1 flex-col items-center gap-2">
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-lg transition-all"
                style={{ height: `${h}%`, background: `linear-gradient(to top, ${color}, ${color}bb)` }}
                title={`${d.total} citas`}
              />
            </div>
            <span className="text-xs text-slate-400">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────
function saludo(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Buen día';
  if (h < 19) return 'Buena tarde';
  return 'Buena noche';
}
function hoyLargo(): string {
  return new Date().toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}
function inic(nombre: string): string {
  return nombre.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}
function espera(checkinAt: string | null): string {
  if (!checkinAt) return '';
  const m = Math.max(0, Math.round((Date.now() - new Date(checkinAt).getTime()) / 60000));
  return `${m} min`;
}
function lerpColor(a: string, b: string, t: number): string {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const c = pa.map((v, i) => Math.round(v + (pb[i]! - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
