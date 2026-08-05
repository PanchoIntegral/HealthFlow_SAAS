'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  cuposDisponibles,
  opcionesEspecialidad,
  type CrearCuentaRequest,
  type CuentaView,
  type CuentasResumen,
  type EspecialidadKey,
  type RolAsignable,
} from '@healthflow/shared-types';
import { useAuth } from '../../lib/auth';
import { api, ApiError } from '../../lib/api';
import { AppShell } from '../../components/app-shell';
import { Modal } from '../../components/modal';
import { IconPlus, IconStethoscope, IconUsers } from '../../components/icons';

const ESPECIALIDADES = opcionesEspecialidad();

/**
 * Qué puede hacer cada rol, en el lenguaje de quien contrata — no en el de
 * CASL. Se muestra ANTES de crear la cuenta: elegir un rol es una decisión de
 * permisos sobre un expediente clínico, y quien la toma merece leer qué está
 * concediendo sin tener que probarlo después.
 */
const PERMISOS: Record<RolAsignable, { titulo: string; sub: string; puede: string[]; noPuede: string[] }> = {
  medico: {
    titulo: 'Médico',
    sub: 'Cuenta completa, con su propia agenda',
    puede: [
      'Su agenda, su sala de espera y sus consultas',
      'Expedientes y notas clínicas (NOM-004)',
      'Presupuestos, facturación y finanzas',
      'Alta de pacientes',
    ],
    noPuede: ['Administrar las cuentas del equipo'],
  },
  asistente: {
    titulo: 'Asistente',
    sub: 'Recepción: agenda y pacientes',
    puede: [
      'Agendar, cancelar y mover citas de etapa',
      'Registrar la llegada del paciente (check-in)',
      'Dar de alta pacientes y capturar su ficha',
      'Cobrar y facturar en recepción',
    ],
    noPuede: ['Abrir ni escribir notas clínicas', 'Ver las finanzas del consultorio'],
  },
};

export default function CuentasPage() {
  const router = useRouter();
  const { token, user, ready } = useAuth();

  const [data, setData] = useState<CuentasResumen | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (ready && !token) router.replace('/login');
    // Administrar cuentas es del titular. El API lo exige igual (CASL), esto
    // solo evita enseñar una pantalla que va a responder 403.
    if (ready && user && user.rol !== 'admin') router.replace('/dashboard');
  }, [ready, token, user, router]);

  const cargar = useCallback(async () => {
    if (!token) return;
    try {
      setData(await api.cuentas(token));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron cargar las cuentas');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const cupos = useMemo(
    () =>
      data ? cuposDisponibles(data.limites, data.medicosActivos, data.asistentesActivos) : null,
    [data],
  );

  async function cambiarEstado(cuenta: CuentaView) {
    if (!token) return;
    setAviso(null);
    try {
      await api.cambiarEstadoCuenta(token, cuenta.id, { activo: !cuenta.activo });
      await cargar();
    } catch (err) {
      setAviso(err instanceof ApiError ? err.message : 'No se pudo actualizar la cuenta');
    }
  }

  if (!ready || !token || user?.rol !== 'admin') return null;

  const medicos = data?.cuentas.filter((c) => c.rol !== 'asistente') ?? [];
  const asistentes = data?.cuentas.filter((c) => c.rol === 'asistente') ?? [];

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl p-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Cuentas</h1>
            <p className="text-sm text-slate-500">
              Da de alta a los médicos de tu consultorio y a tu asistente. Todos comparten la misma
              clínica, pacientes y agenda.
            </p>
          </div>
          <button
            onClick={() => setModalAbierto(true)}
            disabled={loading || (!cupos?.puedeAgregarMedico && !cupos?.puedeAgregarAsistente)}
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <IconPlus />
            Agregar cuenta
          </button>
        </header>

        {error && (
          <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}
        {aviso && (
          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {aviso}
          </p>
        )}

        {loading ? (
          <div className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white" />
        ) : (
          data &&
          cupos && (
            <>
              <TarjetaPlan data={data} />

              <section className="mt-6">
                <TituloSeccion
                  icon={<IconStethoscope size={16} />}
                  titulo="Médicos"
                  contador={`${data.medicosActivos}${
                    data.limites.maxMedicos === null ? '' : ` de ${data.limites.maxMedicos}`
                  }`}
                />
                <div className="space-y-2">
                  {medicos.map((c) => (
                    <FilaCuenta
                      key={c.id}
                      cuenta={c}
                      esYo={c.id === user.id}
                      onToggle={() => cambiarEstado(c)}
                    />
                  ))}
                </div>
              </section>

              <section className="mt-8">
                <TituloSeccion
                  icon={<IconUsers size={16} />}
                  titulo="Asistentes"
                  contador={`${data.asistentesActivos}${
                    data.limites.maxAsistentes === null ? '' : ` de ${data.limites.maxAsistentes}`
                  }`}
                />
                {asistentes.length === 0 ? (
                  <EmptyAsistente
                    puede={cupos.puedeAgregarAsistente}
                    onAgregar={() => setModalAbierto(true)}
                  />
                ) : (
                  <div className="space-y-2">
                    {asistentes.map((c) => (
                      <FilaCuenta
                        key={c.id}
                        cuenta={c}
                        esYo={c.id === user.id}
                        onToggle={() => cambiarEstado(c)}
                      />
                    ))}
                  </div>
                )}
              </section>
            </>
          )
        )}
      </div>

      {modalAbierto && data && cupos && (
        <NuevaCuentaModal
          token={token}
          puedeMedico={cupos.puedeAgregarMedico}
          puedeAsistente={cupos.puedeAgregarAsistente}
          medicos={medicos.filter((m) => m.activo)}
          onClose={() => setModalAbierto(false)}
          onCreada={async () => {
            setModalAbierto(false);
            await cargar();
          }}
        />
      )}
    </AppShell>
  );
}

// ── Tarjeta del plan ─────────────────────────────────────────────

function TarjetaPlan({ data }: { data: CuentasResumen }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Tu plan</p>
          <p className="text-lg font-bold">{data.limites.nombre}</p>
        </div>
        {(data.limites.maxMedicos !== null || data.limites.maxPacientes !== null) && (
          <a
            href="mailto:ventas@healthflow.com.mx?subject=Quiero%20mejorar%20mi%20plan"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-brand-blue hover:text-brand-blue"
          >
            Mejorar plan
          </a>
        )}
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <BarraCupo
          etiqueta="Médicos"
          usados={data.medicosActivos}
          maximo={data.limites.maxMedicos}
        />
        <BarraCupo
          etiqueta="Asistentes"
          usados={data.asistentesActivos}
          maximo={data.limites.maxAsistentes}
        />
      </div>

      <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
        {data.limites.maxPacientes === null
          ? 'Pacientes ilimitados.'
          : `Incluye hasta ${data.limites.maxPacientes} pacientes.`}{' '}
        Las cuentas desactivadas no ocupan lugar.
      </p>
    </div>
  );
}

function BarraCupo({
  etiqueta,
  usados,
  maximo,
}: {
  etiqueta: string;
  usados: number;
  maximo: number | null;
}) {
  const lleno = maximo !== null && usados >= maximo;
  const porcentaje = maximo === null ? 100 : Math.min(100, Math.round((usados / maximo) * 100));

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-sm">
        <span className="font-medium text-slate-600">{etiqueta}</span>
        <span className={lleno ? 'font-semibold text-amber-600' : 'text-slate-400'}>
          {maximo === null ? `${usados} · sin límite` : `${usados} de ${maximo}`}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-all ${
            maximo === null
              ? 'bg-slate-200'
              : lleno
                ? 'bg-amber-400'
                : 'bg-gradient-to-r from-brand-blue to-brand-green'
          }`}
          style={{ width: `${porcentaje}%` }}
        />
      </div>
    </div>
  );
}

// ── Lista ────────────────────────────────────────────────────────

function TituloSeccion({
  icon,
  titulo,
  contador,
}: {
  icon: React.ReactNode;
  titulo: string;
  contador: string;
}) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-500">
      <span className="text-slate-400">{icon}</span>
      {titulo}
      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500">
        {contador}
      </span>
    </h2>
  );
}

function FilaCuenta({
  cuenta,
  esYo,
  onToggle,
}: {
  cuenta: CuentaView;
  esYo: boolean;
  onToggle: () => void;
}) {
  const iniciales = cuenta.nombre
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm transition ${
        cuenta.activo ? 'border-slate-200' : 'border-dashed border-slate-200 opacity-60'
      }`}
    >
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-blue/10 text-sm font-semibold text-brand-blue">
        {iniciales}
      </div>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          <span className="truncate">{cuenta.nombre}</span>
          {esYo && (
            <span className="rounded-md bg-brand-blue/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-blue">
              Tú
            </span>
          )}
          {cuenta.esTitular && (
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
              Titular
            </span>
          )}
          {!cuenta.activo && (
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
              Desactivada
            </span>
          )}
        </p>
        <p className="truncate text-sm text-slate-500">{cuenta.email}</p>
        <p className="mt-0.5 text-xs text-slate-400">
          {cuenta.rol === 'asistente'
            ? cuenta.medicoTitularNombre
              ? `Asiste a ${cuenta.medicoTitularNombre}`
              : 'Asistente'
            : (cuenta.especialidad ?? 'Médico')}
        </p>
      </div>

      {!cuenta.esTitular && (
        <button
          onClick={onToggle}
          className={`shrink-0 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
            cuenta.activo
              ? 'border-slate-200 text-slate-500 hover:border-red-200 hover:text-red-600'
              : 'border-slate-200 text-brand-blue hover:border-brand-blue'
          }`}
        >
          {cuenta.activo ? 'Desactivar' : 'Reactivar'}
        </button>
      )}
    </div>
  );
}

function EmptyAsistente({ puede, onAgregar }: { puede: boolean; onAgregar: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-6 text-center">
      <p className="text-sm font-medium text-slate-600">Todavía no tienes asistente</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">
        Una cuenta de asistente gestiona tu agenda —crea citas, registra llegadas y las mueve de
        etapa— y da de alta pacientes, sin acceso a tus notas clínicas.
      </p>
      {puede && (
        <button
          onClick={onAgregar}
          className="mt-4 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-brand-blue transition hover:border-brand-blue"
        >
          Crear cuenta de asistente
        </button>
      )}
    </div>
  );
}

// ── Alta ─────────────────────────────────────────────────────────

/** Contraseña inicial legible pero fuerte, para no obligar a inventarla. */
function generarPassword(): string {
  const alfabeto = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(14));
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join('');
}

function NuevaCuentaModal({
  token,
  puedeMedico,
  puedeAsistente,
  medicos,
  onClose,
  onCreada,
}: {
  token: string;
  puedeMedico: boolean;
  puedeAsistente: boolean;
  medicos: CuentaView[];
  onClose: () => void;
  onCreada: () => void | Promise<void>;
}) {
  const [rol, setRol] = useState<RolAsignable>(puedeMedico ? 'medico' : 'asistente');
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(() => generarPassword());
  const [cedula, setCedula] = useState('');
  const [especialidadKey, setEspecialidadKey] = useState<EspecialidadKey>('general');
  const [especialidad, setEspecialidad] = useState('');
  const [medicoTitularId, setMedicoTitularId] = useState(medicos[0]?.id ?? '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creada, setCreada] = useState<{ email: string; password: string } | null>(null);

  const permisos = PERMISOS[rol];

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (nombre.trim().length < 2) return setError('Escribe el nombre completo.');
    if (password.length < 8) return setError('La contraseña debe tener al menos 8 caracteres.');

    const body: CrearCuentaRequest = {
      nombre: nombre.trim(),
      email: email.trim().toLowerCase(),
      password,
      rol,
      ...(rol === 'medico'
        ? {
            cedulaProfesional: cedula.trim() || undefined,
            especialidadKey,
            especialidad: especialidad.trim() || undefined,
          }
        : { medicoTitularId: medicoTitularId || undefined }),
    };

    setGuardando(true);
    try {
      const cuenta = await api.crearCuenta(token, body);
      // La contraseña se muestra UNA vez, aquí: el backend solo guarda su hash
      // bcrypt y nadie —ni el titular— puede volver a consultarla.
      setCreada({ email: cuenta.email, password });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear la cuenta');
    } finally {
      setGuardando(false);
    }
  }

  if (creada) {
    return (
      <Modal titulo="Cuenta creada" onClose={() => void onCreada()} ancho="max-w-md">
        <p className="text-sm text-slate-600">
          Comparte estos datos con la persona. Podrá cambiar la contraseña desde{' '}
          <span className="font-medium">Ajustes</span> al entrar.
        </p>
        <dl className="mt-4 space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Correo</dt>
            <dd className="truncate font-medium">{creada.email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Contraseña</dt>
            <dd className="font-mono font-medium">{creada.password}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-amber-700">
          Se muestra una sola vez: en la base solo queda el hash. Si se pierde, se restablece con
          &ldquo;¿Olvidaste tu contraseña?&rdquo;.
        </p>
        <button
          onClick={() => void onCreada()}
          className="mt-5 w-full rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2.5 font-semibold text-white transition hover:opacity-95"
        >
          Listo
        </button>
      </Modal>
    );
  }

  return (
    <Modal
      titulo="Agregar cuenta"
      subtitulo="La cuenta nueva trabaja dentro de tu consultorio."
      onClose={onClose}
      ancho="max-w-lg"
    >
      <form onSubmit={onSubmit} className="space-y-5">
        {/* El rol se elige primero: cambia el resto del formulario y, sobre
            todo, cambia a qué da acceso. */}
        <div className="grid grid-cols-2 gap-3">
          <TarjetaRol
            activo={rol === 'medico'}
            disponible={puedeMedico}
            titulo={PERMISOS.medico.titulo}
            sub={PERMISOS.medico.sub}
            icon={<IconStethoscope />}
            onClick={() => setRol('medico')}
          />
          <TarjetaRol
            activo={rol === 'asistente'}
            disponible={puedeAsistente}
            titulo={PERMISOS.asistente.titulo}
            sub={PERMISOS.asistente.sub}
            icon={<IconUsers />}
            onClick={() => setRol('asistente')}
          />
        </div>

        <div className="rounded-xl bg-slate-50 p-4 text-sm">
          <ul className="space-y-1">
            {permisos.puede.map((p) => (
              <li key={p} className="flex gap-2 text-slate-600">
                <span className="text-brand-green">✓</span>
                {p}
              </li>
            ))}
            {permisos.noPuede.map((p) => (
              <li key={p} className="flex gap-2 text-slate-400">
                <span>✕</span>
                {p}
              </li>
            ))}
          </ul>
        </div>

        <Campo etiqueta="Nombre completo">
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder={rol === 'medico' ? 'Dra. Ana López' : 'María Hernández'}
            className={inputClass}
            required
          />
        </Campo>

        <Campo etiqueta="Correo" ayuda="Con este correo inicia sesión.">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="correo@consultorio.mx"
            className={inputClass}
            required
          />
        </Campo>

        <Campo etiqueta="Contraseña inicial" ayuda="La podrá cambiar al entrar.">
          <div className="flex gap-2">
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${inputClass} font-mono`}
              minLength={8}
              required
            />
            <button
              type="button"
              onClick={() => setPassword(generarPassword())}
              className="shrink-0 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-600 transition hover:border-brand-blue hover:text-brand-blue"
            >
              Generar
            </button>
          </div>
        </Campo>

        {rol === 'medico' ? (
          <>
            <Campo
              etiqueta="Especialidad clínica"
              ayuda="Personaliza los campos de su nota. Podrá cambiarla desde Ajustes."
            >
              <select
                value={especialidadKey}
                onChange={(e) => setEspecialidadKey(e.target.value as EspecialidadKey)}
                className={inputClass}
              >
                {ESPECIALIDADES.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo etiqueta="Etiqueta en agenda (opcional)">
                <input
                  value={especialidad}
                  onChange={(e) => setEspecialidad(e.target.value)}
                  placeholder="Ortodoncia"
                  className={inputClass}
                />
              </Campo>
              <Campo etiqueta="Cédula profesional (opcional)">
                <input
                  value={cedula}
                  onChange={(e) => setCedula(e.target.value)}
                  placeholder="1234567"
                  className={inputClass}
                />
              </Campo>
            </div>
          </>
        ) : (
          medicos.length > 1 && (
            <Campo etiqueta="Asiste a" ayuda="A qué médico apoya principalmente.">
              <select
                value={medicoTitularId}
                onChange={(e) => setMedicoTitularId(e.target.value)}
                className={inputClass}
              >
                {medicos.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
              </select>
            </Campo>
          )
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-500 hover:text-slate-700"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-50"
          >
            {guardando ? 'Creando…' : 'Crear cuenta'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 disabled:bg-slate-50';

function Campo({
  etiqueta,
  ayuda,
  children,
}: {
  etiqueta: string;
  ayuda?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-600">{etiqueta}</span>
      {children}
      {ayuda && <span className="mt-1 block text-xs text-slate-400">{ayuda}</span>}
    </label>
  );
}

function TarjetaRol({
  activo,
  disponible,
  titulo,
  sub,
  icon,
  onClick,
}: {
  activo: boolean;
  disponible: boolean;
  titulo: string;
  sub: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!disponible}
      title={disponible ? undefined : 'Tu plan no tiene lugares disponibles de este tipo'}
      className={`rounded-xl border p-4 text-left transition ${
        activo
          ? 'border-brand-blue bg-brand-blue/5 ring-2 ring-brand-blue/20'
          : 'border-slate-200 hover:border-slate-300'
      } ${disponible ? '' : 'cursor-not-allowed opacity-40'}`}
    >
      <span className={activo ? 'text-brand-blue' : 'text-slate-400'}>{icon}</span>
      <p className="mt-2 font-semibold">{titulo}</p>
      <p className="text-xs text-slate-500">{sub}</p>
      {!disponible && <p className="mt-1 text-xs font-medium text-amber-600">Sin lugares</p>}
    </button>
  );
}
