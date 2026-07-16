'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreatePatientRequest } from '@healthflow/shared-types';
import { useAuth } from '../../lib/auth';
import { api, ApiError } from '../../lib/api';
import { AppShell } from '../../components/app-shell';

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
      <main className="mx-auto max-w-4xl px-8 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Expedientes</h1>
          {canCreate && (
            <button
              onClick={() => setShowForm((v) => !v)}
              className="rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95"
            >
              {showForm ? 'Cerrar' : '+ Nuevo paciente'}
            </button>
          )}
        </div>

        {showForm && canCreate && (
          <NewPatientForm
            onCreated={() => {
              setShowForm(false);
              queryClient.invalidateQueries({ queryKey: ['patients'] });
            }}
            token={token}
          />
        )}

        <div className="relative mb-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre o CURP…"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20"
          />
        </div>

        {results.isLoading ? (
          <p className="py-8 text-center text-sm text-slate-400">Cargando pacientes…</p>
        ) : results.data && results.data.length > 0 ? (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {results.data.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => canOpenRecord && router.push(`/pacientes/${p.id}`)}
                  disabled={!canOpenRecord}
                  className={`flex w-full items-center justify-between px-4 py-3 text-left transition ${
                    canOpenRecord ? 'cursor-pointer hover:bg-slate-50' : 'cursor-default'
                  }`}
                >
                  <div>
                    <p className="font-medium">{p.nombre}</p>
                    <p className="text-xs text-slate-500">
                      {p.edad} años{p.curp ? ` · ${p.curp}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {p.telefono && <span className="text-sm text-slate-500">{p.telefono}</span>}
                    {canOpenRecord && (
                      <span className="text-sm font-medium text-brand-blue">
                        Ver expediente →
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-8 text-center text-sm text-slate-400">
            {debounced.trim().length >= 2 ? 'Sin resultados.' : 'Aún no hay pacientes registrados.'}
          </p>
        )}
      </main>
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
      className="mb-6 grid gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2"
    >
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
