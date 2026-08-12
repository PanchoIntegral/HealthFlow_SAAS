'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { opcionesEspecialidad, type EspecialidadKey } from '@healthflow/shared-types';
import { useAuth } from '../../lib/auth';
import { api, ApiError } from '../../lib/api';
import { AppShell } from '../../components/app-shell';
import { FacturacionSeccion } from '../../components/facturacion-seccion';
import { WhatsappSeccion } from '../../components/whatsapp-seccion';

const OPCIONES = opcionesEspecialidad();

type SeccionKey = 'perfil' | 'seguridad' | 'whatsapp' | 'facturacion';

const SECCIONES: { key: SeccionKey; nombre: string; descripcion: string }[] = [
  { key: 'perfil', nombre: 'Perfil profesional', descripcion: 'Cómo es tu nota y con qué datos se firma.' },
  { key: 'seguridad', nombre: 'Seguridad', descripcion: 'Tu contraseña de acceso.' },
  {
    key: 'whatsapp',
    nombre: 'Recordatorios',
    descripcion: 'Avisos de cita por WhatsApp y cuándo se envían.',
  },
  { key: 'facturacion', nombre: 'Facturación', descripcion: 'Plan, método de pago e historial de cobros.' },
];

/** Secciones que solo ve el titular: quién paga y con qué número se manda. */
const SOLO_TITULAR: SeccionKey[] = ['whatsapp', 'facturacion'];

/**
 * Ajustes de la cuenta, organizados por secciones.
 *
 * Navegación lateral y no una lista de tarjetas apiladas: los ajustes crecen
 * (perfil, seguridad, facturación, y lo que venga) y una sola columna larga
 * obliga a recorrer todo para llegar a lo último. Cada sección se lleva el
 * ancho completo del contenido, que es lo que faltaba.
 */
export default function AjustesPage() {
  const router = useRouter();
  const { token, user, ready } = useAuth();
  const [seccion, setSeccion] = useState<SeccionKey>('perfil');

  useEffect(() => {
    if (ready && !token) router.replace('/login');
  }, [ready, token, router]);

  if (!ready || !token || !user) return null;

  /**
   * Facturación es del TITULAR y de nadie más — mismo criterio que el
   * servidor, que exige `read` sobre 'Cuenta' y solo se lo concede a 'admin'.
   * Ocultar la pestaña no es la protección (el 403 lo es); es no ofrecerle a
   * un médico contratado una puerta que se le va a cerrar en la cara.
   */
  const esTitular = user.rol === 'admin';
  const visibles = SECCIONES.filter((s) => !SOLO_TITULAR.includes(s.key) || esTitular);
  const actual = visibles.find((s) => s.key === seccion) ?? visibles[0]!;

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-8 py-8">
        <header className="mb-8">
          <h1 className="text-2xl font-bold">Ajustes</h1>
          <p className="text-sm text-slate-500">
            Tu cuenta, tu perfil profesional{esTitular ? ' y la suscripción de la clínica' : ''}.
          </p>
        </header>

        <div className="flex flex-col gap-8 md:flex-row">
          {/* En móvil la navegación se vuelve una fila desplazable: una columna
              lateral de 200px sobre una pantalla de 375 no deja sitio al
              contenido, que es lo que se viene a leer. */}
          <nav
            aria-label="Secciones de ajustes"
            className="flex shrink-0 gap-1 overflow-x-auto md:w-56 md:flex-col md:overflow-visible"
          >
            {visibles.map((s) => {
              const activa = s.key === actual.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSeccion(s.key)}
                  aria-current={activa ? 'page' : undefined}
                  className={`whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                    activa
                      ? 'bg-brand-blue/10 text-brand-blue'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {s.nombre}
                </button>
              );
            })}
          </nav>

          <div className="min-w-0 flex-1">
            <div className="mb-4">
              <h2 className="text-lg font-semibold">{actual.nombre}</h2>
              <p className="text-sm text-slate-500">{actual.descripcion}</p>
            </div>

            {actual.key === 'perfil' && <PerfilSeccion token={token} />}
            {actual.key === 'seguridad' && <SeguridadSeccion token={token} />}
            {actual.key === 'whatsapp' && <WhatsappSeccion token={token} />}
            {actual.key === 'facturacion' && <FacturacionSeccion token={token} />}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

const CAMPO =
  'w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 disabled:bg-slate-50';
const BOTON =
  'rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2.5 font-semibold text-white transition hover:opacity-95 disabled:opacity-50';

function Tarjeta({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">{children}</div>
  );
}

// ── Perfil ────────────────────────────────────────────────────────

function PerfilSeccion({ token }: { token: string }) {
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

  return (
    <div className="space-y-4">
      {/* El aviso va ARRIBA de la sección y solo para quien firma notas: una
          nota cerrada sin cédula ya no se puede reparar, así que enterarse
          tarde no sirve de nada. */}
      {perfilCargado && cedulaGuardada === null && rol !== 'asistente' && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Falta tu cédula profesional</p>
          <p className="mt-1 text-sm leading-relaxed text-amber-800">
            La NOM-004 exige que cada nota lleve el nombre y la cédula de quien la firma. Mientras
            no la captures, tus notas se cierran sin ella — y una nota firmada ya no se puede
            modificar.
          </p>
        </div>
      )}

      <Tarjeta>
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block font-medium text-slate-600">Cédula profesional</span>
            <input
              value={cedula}
              onChange={(e) => setCedula(e.target.value)}
              disabled={loading}
              placeholder="1234567"
              inputMode="text"
              maxLength={40}
              className={CAMPO}
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
              className={CAMPO}
            >
              {OPCIONES.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.nombre}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-400">
              Decide qué campos, etiquetas y signos vitales pide tu nota.
            </span>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">
              Etiqueta mostrada en agenda
            </span>
            <input
              value={especialidad}
              onChange={(e) => setEspecialidad(e.target.value)}
              disabled={loading}
              placeholder="p.ej. Cardiología intervencionista"
              className={CAMPO}
            />
            <span className="mt-1 block text-xs text-slate-400">
              Texto libre: es solo lo que se muestra en el selector de agenda.
            </span>
          </label>

          <div className="sm:col-span-2">
            <p className="text-xs text-slate-400">
              Cambiar la especialidad solo afecta tus próximas notas — las que ya cerraste no se
              reinterpretan.
            </p>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            {guardado && <p className="mt-2 text-sm text-emerald-600">Cambios guardados.</p>}
            <button type="submit" disabled={loading || saving} className={`mt-4 ${BOTON}`}>
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </Tarjeta>
    </div>
  );
}

// ── Seguridad ─────────────────────────────────────────────────────

function SeguridadSeccion({ token }: { token: string }) {
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
    <Tarjeta>
      <form onSubmit={onSubmit} className="max-w-md space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Contraseña actual</span>
          <input
            type="password"
            autoComplete="current-password"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            className={CAMPO}
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Contraseña nueva</span>
          <input
            type="password"
            autoComplete="new-password"
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            className={CAMPO}
          />
          <span className="mt-1 block text-xs text-slate-400">Mínimo 8 caracteres.</span>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Confirmar contraseña nueva</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmar}
            onChange={(e) => setConfirmar(e.target.value)}
            className={CAMPO}
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {guardado && <p className="text-sm text-emerald-600">Contraseña actualizada.</p>}

        <button type="submit" disabled={saving} className={BOTON}>
          {saving ? 'Guardando…' : 'Cambiar contraseña'}
        </button>
      </form>
    </Tarjeta>
  );
}
