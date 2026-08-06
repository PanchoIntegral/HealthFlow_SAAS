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
  const [cedula, setCedula] = useState('');
  /** Cédula tal como está GUARDADA. Dispara el aviso, no lo que se va tecleando. */
  const [cedulaGuardada, setCedulaGuardada] = useState<string | null>(null);
  const [rol, setRol] = useState<string>('medico');
  /**
   * Solo true si el perfil se leyó BIEN. `loading` no basta: baja a false
   * también cuando la petición falla, y ahí el aviso de "falta tu cédula"
   * saldría sin haber leído nunca si la tiene o no.
   */
  const [perfilCargado, setPerfilCargado] = useState(false);
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
        setCedula(profile.cedulaProfesional ?? '');
        setCedulaGuardada(profile.cedulaProfesional);
        setRol(profile.rol);
        setPerfilCargado(true);
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
      const perfil = await api.updatePerfil(token, {
        especialidadKey,
        especialidad: especialidad.trim() || undefined,
        // Se manda siempre (aunque vaya vacío): así vaciar el campo borra la
        // cédula guardada, en vez de dejarla ahí sin forma de corregir un error
        // de captura.
        cedulaProfesional: cedula.trim(),
      });
      setCedulaGuardada(perfil.cedulaProfesional);
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
          <p className="text-sm text-slate-500">
            Tu perfil profesional decide cómo es tu nota clínica y con qué datos se firma.
          </p>
        </div>

        {/* El aviso va ARRIBA de todo y solo para quien firma notas: una nota
            cerrada sin cédula ya no se puede reparar, así que enterarse tarde
            no sirve de nada. */}
        {perfilCargado && cedulaGuardada === null && rol !== 'asistente' && (
          <div className="mb-6 max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">Falta tu cédula profesional</p>
            <p className="mt-1 text-sm leading-relaxed text-amber-800">
              La NOM-004 exige que cada nota lleve el nombre y la cédula de quien la firma.
              Mientras no la captures, tus notas se cierran sin ella — y una nota firmada ya no
              se puede modificar.
            </p>
          </div>
        )}

        <form
          onSubmit={onSubmit}
          className="max-w-lg space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h2 className="text-lg font-semibold">Perfil profesional</h2>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">Cédula profesional</span>
            <input
              value={cedula}
              onChange={(e) => setCedula(e.target.value)}
              disabled={loading}
              placeholder="1234567"
              inputMode="text"
              maxLength={40}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 disabled:bg-slate-50"
            />
            <span className="mt-1 block text-xs text-slate-400">
              Se estampa en la firma de cada nota que cierres, junto con tu nombre y la fecha.
            </span>
          </label>

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

        <CambiarPasswordCard token={token} />
      </div>
    </AppShell>
  );
}

function CambiarPasswordCard({ token }: { token: string }) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setGuardado(false);

    if (nueva.length < 8) {
      setError('La contraseña nueva debe tener al menos 8 caracteres.');
      return;
    }
    if (nueva !== confirmar) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setSaving(true);
    try {
      await api.changePassword(token, { currentPassword: actual, newPassword: nueva });
      setGuardado(true);
      setActual('');
      setNueva('');
      setConfirmar('');
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'La contraseña actual no es correcta.'
          : err instanceof ApiError
            ? err.message
            : 'Error de conexión',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-6 max-w-lg space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h2 className="text-lg font-semibold">Contraseña</h2>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-600">Contraseña actual</span>
        <input
          type="password"
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20"
        />
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-600">Contraseña nueva</span>
        <input
          type="password"
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20"
        />
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-600">Confirmar contraseña nueva</span>
        <input
          type="password"
          value={confirmar}
          onChange={(e) => setConfirmar(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {guardado && <p className="text-sm text-emerald-600">Contraseña actualizada.</p>}

      <button
        type="submit"
        disabled={saving}
        className="rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2.5 font-semibold text-white transition hover:opacity-95 disabled:opacity-50"
      >
        {saving ? 'Guardando…' : 'Cambiar contraseña'}
      </button>
    </form>
  );
}
