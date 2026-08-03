'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { opcionesEspecialidad, type EspecialidadKey } from '@healthflow/shared-types';
import { useAuth } from '../../lib/auth';
import { api, ApiError } from '../../lib/api';
import { AppShell } from '../../components/app-shell';

const OPCIONES = opcionesEspecialidad();

export default function AjustesPage() {
  const router = useRouter();
  const { token, ready } = useAuth();

  const [especialidadKey, setEspecialidadKey] = useState<EspecialidadKey>('general');
  const [especialidad, setEspecialidad] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  useEffect(() => {
    if (ready && !token) router.replace('/login');
  }, [ready, token, router]);

  useEffect(() => {
    if (!token) return;
    api
      .getMyProfile(token)
      .then((profile) => {
        setEspecialidadKey(profile.especialidadKey);
        setEspecialidad(profile.especialidad ?? '');
      })
      .catch(() => setError('No se pudo cargar tu perfil'))
      .finally(() => setLoading(false));
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setGuardado(false);
    setSaving(true);
    try {
      await api.updateEspecialidad(token, {
        especialidadKey,
        especialidad: especialidad.trim() || undefined,
      });
      setGuardado(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error de conexión');
    } finally {
      setSaving(false);
    }
  }

  if (!ready || !token) return null;

  return (
    <AppShell>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Ajustes</h1>
          <p className="text-sm text-slate-500">Tu especialidad personaliza los campos de tu nota clínica.</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="max-w-lg space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h2 className="text-lg font-semibold">Especialidad</h2>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">Especialidad clínica</span>
            <select
              value={especialidadKey}
              onChange={(e) => setEspecialidadKey(e.target.value as EspecialidadKey)}
              disabled={loading}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 disabled:bg-slate-50"
            >
              {OPCIONES.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.nombre}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-400">
              Decide qué campos, etiquetas y signos vitales pide tu nota clínica.
            </span>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">Etiqueta mostrada en agenda</span>
            <input
              value={especialidad}
              onChange={(e) => setEspecialidad(e.target.value)}
              disabled={loading}
              placeholder="p.ej. Cardiología intervencionista"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 disabled:bg-slate-50"
            />
          </label>

          <p className="text-xs text-slate-400">
            Cambiar la especialidad solo afecta tus próximas notas — las que ya cerraste no se
            reinterpretan.
          </p>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {guardado && <p className="text-sm text-emerald-600">Cambios guardados.</p>}

          <button
            type="submit"
            disabled={loading || saving}
            className="rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2.5 font-semibold text-white transition hover:opacity-95 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </form>
      </div>
    </AppShell>
  );
}
