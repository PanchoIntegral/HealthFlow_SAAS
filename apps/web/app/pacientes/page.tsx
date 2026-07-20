'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreatePatientRequest } from '@healthflow/shared-types';
import { useAuth } from '../../lib/auth';
import { api, ApiError } from '../../lib/api';
import { AppShell } from '../../components/app-shell';
import { IconLock, IconPhone, IconRecords, IconSearch } from '../../components/icons';

const AVATAR_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-violet-100 text-violet-700',
  'bg-rose-100 text-rose-700',
  'bg-cyan-100 text-cyan-700',
];

function initials(nombre: string): string {
  return nombre.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}

function avatarColor(seed: string): string {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[hash];
}

export default function PacientesPage() {
  const router = useRouter();
  const { token, user, ready } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (ready && !token) router.replace('/login');
  }, [ready, token, router]);

  // Debounce ligero para no disparar una búsqueda por cada tecla.
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Sin búsqueda el API devuelve el directorio completo del consultorio.
  const results = useQuery({
    queryKey: ['patients', debounced],
    queryFn: () => api.searchPatients(token!, debounced),
    enabled: !!token,
  });

  if (!ready || !token || !user) return null;

  const canCreate = ['asistente', 'medico', 'admin'].includes(user.rol);
  // El contenido clínico es solo para médico/admin (RBAC): el asistente ve el
  // directorio pero no puede abrir el expediente.
  const canOpenRecord = ['medico', 'admin'].includes(user.rol);

  return (
    <AppShell>
      <div>
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-8 py-4">
          <div>
            <h1 className="text-xl font-bold">Expedientes</h1>
            <p className="text-sm text-slate-500">
              {results.data
                ? `${results.data.length} paciente${results.data.length === 1 ? '' : 's'} en el directorio`
                : 'Directorio de pacientes de la clínica'}
            </p>
          </div>
          {canCreate && (
            <button
              onClick={() => setShowForm((v) => !v)}
              className="rounded-xl bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand-blue/20 transition hover:opacity-95"
            >
              {showForm ? 'Cerrar' : '+ Nuevo paciente'}
            </button>
          )}
        </header>

        <div className="mx-auto max-w-4xl px-8 py-8">
          {showForm && canCreate && (
            <NewPatientForm
              onCreated={() => {
                setShowForm(false);
                queryClient.invalidateQueries({ queryKey: ['patients'] });
              }}
              token={token}
            />
          )}

          <div className="relative mb-5">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
              <IconSearch />
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre o CURP…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 outline-none transition focus:border-brand-blue focus:bg-white focus:ring-2 focus:ring-brand-blue/20"
            />
          </div>

          {results.isLoading ? (
            <p className="py-12 text-center text-sm text-slate-400">Cargando pacientes…</p>
          ) : results.data && results.data.length > 0 ? (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              {results.data.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => canOpenRecord && router.push(`/pacientes/${p.id}`)}
                    disabled={!canOpenRecord}
                    className={`group flex w-full items-center gap-4 px-5 py-4 text-left transition ${
                      canOpenRecord ? 'cursor-pointer hover:bg-slate-50' : 'cursor-default'
                    }`}
                  >
                    <div
                      className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-semibold ${avatarColor(p.id)}`}
                    >
                      {initials(p.nombre)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-900">{p.nombre}</p>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                        <span>{p.edad} años</span>
                        {p.curp && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] tracking-wide text-slate-500">
                            {p.curp}
                          </span>
                        )}
                      </div>
                    </div>

                    {p.telefono && (
                      <span className="hidden shrink-0 items-center gap-1.5 text-sm text-slate-500 sm:flex">
                        <IconPhone size={14} />
                        {p.telefono}
                      </span>
                    )}

                    {canOpenRecord ? (
                      <span className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-brand-blue transition group-hover:border-brand-blue">
                        Ver expediente →
                      </span>
                    ) : (
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-slate-400">
                        <IconLock size={13} />
                        Sin acceso
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-14 text-center">
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400">
                <IconRecords />
              </div>
              <p className="text-sm text-slate-500">
                {debounced.trim().length >= 2 ? 'Sin resultados para tu búsqueda.' : 'Aún no hay pacientes registrados.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function NewPatientForm({
  token,
  onCreated,
}: {
  token: string;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<CreatePatientRequest>({
    nombre: '',
    fechaNacimiento: '',
    curp: '',
    telefono: '',
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.createPatient(token, {
        nombre: form.nombre,
        fechaNacimiento: form.fechaNacimiento,
        curp: form.curp?.trim() || null,
        telefono: form.telefono?.trim() || null,
      }),
    onSuccess: onCreated,
  });

  const set = (k: keyof CreatePatientRequest) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
      className="mb-6 grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2"
    >
      <h2 className="text-sm font-semibold text-slate-700 sm:col-span-2">Nuevo paciente</h2>

      <label className="text-sm sm:col-span-2">
        <span className="mb-1 block font-medium text-slate-600">Nombre completo *</span>
        <input
          required
          value={form.nombre}
          onChange={set('nombre')}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-blue"
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium text-slate-600">Fecha de nacimiento *</span>
        <input
          required
          type="date"
          value={form.fechaNacimiento}
          onChange={set('fechaNacimiento')}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-blue"
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium text-slate-600">CURP</span>
        <input
          value={form.curp ?? ''}
          onChange={set('curp')}
          maxLength={18}
          placeholder="Opcional"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 uppercase outline-none focus:border-brand-blue"
        />
      </label>
      <label className="text-sm sm:col-span-2">
        <span className="mb-1 block font-medium text-slate-600">Teléfono</span>
        <input
          value={form.telefono ?? ''}
          onChange={set('telefono')}
          placeholder="Opcional"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-blue"
        />
      </label>

      {mutation.isError && (
        <p className="text-sm text-red-600 sm:col-span-2">
          {mutation.error instanceof ApiError ? mutation.error.message : 'Error al guardar'}
        </p>
      )}

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-50"
        >
          {mutation.isPending ? 'Guardando…' : 'Guardar paciente'}
        </button>
      </div>
    </form>
  );
}
