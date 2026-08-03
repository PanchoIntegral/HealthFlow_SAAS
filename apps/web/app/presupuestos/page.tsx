'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { EstatusPresupuesto } from '@healthflow/shared-types';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { AppShell } from '../../components/app-shell';
import { COLOR_ESTATUS, ETIQUETA_ESTATUS, pesos } from '../../components/presupuesto-panel';
import { NuevoPresupuestoModal } from '../../components/nuevo-presupuesto-modal';
import { IconReceipt, IconSearch } from '../../components/icons';

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });

/** Ignora acentos al comparar ("jose" debe encontrar "José"). */
const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Vistas rápidas: agrupan estatus en algo que se entiende de un vistazo. */
const VISTAS = [
  { id: 'activos', label: 'Activos', estatus: ['borrador', 'presentado', 'aceptado'] as EstatusPresupuesto[] },
  { id: 'por-cobrar', label: 'Por cobrar', estatus: ['aceptado'] as EstatusPresupuesto[] },
  { id: 'terminados', label: 'Terminados', estatus: ['terminado'] as EstatusPresupuesto[] },
  { id: 'todos', label: 'Todos', estatus: undefined },
] as const;

/**
 * Tablero de Presupuestos: todos los planes de tratamiento del consultorio,
 * de todos los pacientes, en un solo lugar. Antes solo se veían entrando al
 * expediente de cada paciente uno por uno — esto es lo que un dentista
 * consulta a diario para saber qué falta cotizar, presentar o cobrar.
 */
export default function PresupuestosPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { token, user, ready } = useAuth();

  useEffect(() => {
    if (ready && !token) router.replace('/login');
  }, [ready, token, router]);

  const [vista, setVista] = useState<(typeof VISTAS)[number]['id']>('activos');
  const [busqueda, setBusqueda] = useState('');
  const [modalAbierto, setModalAbierto] = useState(false);

  const estatus = VISTAS.find((v) => v.id === vista)?.estatus;

  const lista = useQuery({
    queryKey: ['presupuestos-todos', estatus],
    queryFn: () => api.listarTodosPresupuestos(token!, estatus),
    enabled: !!token,
  });

  const saldos = useQuery({
    queryKey: ['saldos'],
    queryFn: () => api.saldosPorCobrar(token!),
    enabled: !!token,
  });

  const presupuestos = useMemo(() => {
    const q = normalizar(busqueda.trim());
    const datos = lista.data ?? [];
    if (!q) return datos;
    return datos.filter(
      (p) => normalizar(p.patientNombre).includes(q) || normalizar(p.titulo).includes(q),
    );
  }, [lista.data, busqueda]);

  if (!ready || !token || !user) return null;

  const puedeCrear = user.rol === 'medico' || user.rol === 'admin';

  return (
    <AppShell>
      <div className="p-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Presupuestos</h1>
            <p className="text-sm text-slate-500">
              Planes de tratamiento de todos los pacientes: qué falta cotizar, presentar o cobrar.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative w-full max-w-xs">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-300">
                <IconSearch />
              </span>
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar por paciente o título…"
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-3 text-sm outline-none transition focus:border-brand-blue"
              />
            </div>
            {puedeCrear && (
              <button
                onClick={() => setModalAbierto(true)}
                className="shrink-0 rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95"
              >
                + Nuevo presupuesto
              </button>
            )}
          </div>
        </div>

        {saldos.data && saldos.data.totalCentavos > 0 && (
          <div className="mb-6 flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600">
              <IconReceipt size={22} />
            </div>
            <div className="flex-1">
              <p className="text-sm text-slate-500">Saldo por cobrar</p>
              <p className="text-2xl font-bold tabular-nums text-slate-900">
                {pesos(saldos.data.totalCentavos)}
              </p>
            </div>
            <p className="max-w-[10rem] text-right text-xs leading-snug text-slate-400">
              {saldos.data.presupuestos.length} presupuesto
              {saldos.data.presupuestos.length === 1 ? '' : 's'} aceptado
              {saldos.data.presupuestos.length === 1 ? '' : 's'} con saldo pendiente
            </p>
          </div>
        )}

        <div className="mb-4 flex flex-wrap gap-2">
          {VISTAS.map((v) => (
            <button
              key={v.id}
              onClick={() => setVista(v.id)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                vista === v.id
                  ? 'bg-brand-blue text-white'
                  : 'border border-slate-300 text-slate-600 hover:border-slate-400'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        {lista.isLoading && <p className="text-slate-400">Cargando presupuestos…</p>}

        {lista.data && presupuestos.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-400">
            {busqueda
              ? 'Ningún presupuesto coincide con tu búsqueda.'
              : puedeCrear
                ? 'Sin presupuestos en esta vista. Usa "+ Nuevo presupuesto" para crear uno.'
                : 'Sin presupuestos en esta vista.'}
          </p>
        )}

        {presupuestos.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-6 py-3 font-medium">Paciente</th>
                    <th className="px-6 py-3 font-medium">Presupuesto</th>
                    <th className="px-6 py-3 font-medium">Estatus</th>
                    <th className="px-6 py-3 font-medium">Fecha</th>
                    <th className="px-6 py-3 text-right font-medium">Total</th>
                    <th className="px-6 py-3 text-right font-medium">Saldo</th>
                    <th className="px-6 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {presupuestos.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-6 py-3 font-medium">{p.patientNombre}</td>
                      <td className="px-6 py-3 text-slate-600">{p.titulo}</td>
                      <td className="px-6 py-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${COLOR_ESTATUS[p.estatus]}`}
                        >
                          {ETIQUETA_ESTATUS[p.estatus]}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 text-slate-500">
                        {fecha(p.createdAt)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 text-right font-semibold tabular-nums">
                        {pesos(p.totalCentavos)}
                      </td>
                      <td
                        className={`whitespace-nowrap px-6 py-3 text-right tabular-nums ${
                          p.saldoCentavos > 0 ? 'font-semibold text-amber-700' : 'text-slate-400'
                        }`}
                      >
                        {pesos(p.saldoCentavos)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 text-right">
                        <Link
                          href={`/pacientes/${p.patientId}`}
                          className="text-xs font-medium text-brand-blue hover:underline"
                        >
                          Ver expediente →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {modalAbierto && (
        <NuevoPresupuestoModal
          token={token}
          onClose={() => setModalAbierto(false)}
          onCreado={() => {
            void queryClient.invalidateQueries({ queryKey: ['presupuestos-todos'] });
            void queryClient.invalidateQueries({ queryKey: ['saldos'] });
            setVista('activos');
          }}
        />
      )}
    </AppShell>
  );
}
