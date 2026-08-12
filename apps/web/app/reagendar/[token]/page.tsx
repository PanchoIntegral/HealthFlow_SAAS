'use client';

import { use, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { HuecoDisponible } from '@healthflow/shared-types';
import { api, ApiError } from '../../../lib/api';

/**
 * Página PÚBLICA de reagendado — sin AppShell y sin guard de sesión, que es
 * como se declaran públicas las páginas aquí (igual que /login o
 * /restablecer-password).
 *
 * El paciente no tiene cuenta: llega por el enlace que le mandó su clínica por
 * WhatsApp, y ese enlace es la credencial. Por eso la pantalla no muestra
 * NADA clínico —ni el motivo de la consulta, ni su nombre completo—: el
 * enlace se queda para siempre en el historial de un teléfono que puede
 * acabar prestado o compartido.
 */
export default function ReagendarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-5 py-10">
      <Contenido token={token} />
    </main>
  );
}

function Contenido({ token }: { token: string }) {
  const [elegido, setElegido] = useState<string | null>(null);
  const [listo, setListo] = useState<string | null>(null);

  const cita = useQuery({
    queryKey: ['reagenda', token],
    queryFn: () => api.verReagenda(token),
    retry: false,
  });

  const huecos = useQuery({
    queryKey: ['reagenda-huecos', token],
    queryFn: () => api.huecosReagenda(token),
    enabled: cita.isSuccess,
    retry: false,
  });

  const confirmar = useMutation({
    mutationFn: (inicio: string) => api.confirmarReagenda(token, inicio),
    onSuccess: (r) => setListo(r.inicioProgramado),
  });

  if (listo) {
    return (
      <Tarjeta>
        <div className="text-center">
          <p className="text-4xl">✅</p>
          <h1 className="mt-3 text-xl font-bold text-slate-800">Tu cita quedó reagendada</h1>
          <p className="mt-2 text-slate-600">{fechaLarga(listo)}</p>
          <p className="mt-4 text-sm text-slate-500">
            Ya puedes cerrar esta página. Te esperamos.
          </p>
        </div>
      </Tarjeta>
    );
  }

  if (cita.isLoading) {
    return <Tarjeta><p className="text-center text-slate-500">Cargando…</p></Tarjeta>;
  }

  if (cita.isError) {
    // Un token gastado, caducado o inventado se ven igual desde aquí, a
    // propósito: la diferencia solo le serviría a quien está probando enlaces.
    const conflicto = cita.error instanceof ApiError && cita.error.status === 409;
    return (
      <Tarjeta>
        <div className="text-center">
          <p className="text-4xl">🔗</p>
          <h1 className="mt-3 text-xl font-bold text-slate-800">
            {conflicto ? 'Esta cita ya no se puede cambiar' : 'Este enlace ya no es válido'}
          </h1>
          <p className="mt-2 text-slate-600">
            Comunícate directamente con tu clínica para reagendar tu cita.
          </p>
        </div>
      </Tarjeta>
    );
  }

  const datos = cita.data!;

  return (
    <Tarjeta>
      <header className="border-b border-slate-100 pb-4">
        <p className="text-sm font-medium text-brand-blue">{datos.nombreClinica}</p>
        <h1 className="mt-1 text-xl font-bold text-slate-800">Cambia el horario de tu cita</h1>
        <p className="mt-2 text-sm text-slate-500">
          Actualmente: {fechaLarga(datos.inicioProgramado)} · {datos.doctorNombre}
        </p>
      </header>

      <h2 className="mt-5 text-sm font-semibold text-slate-700">Elige un nuevo horario</h2>

      {huecos.isLoading && <p className="mt-3 text-sm text-slate-500">Buscando horarios…</p>}

      {huecos.isSuccess && huecos.data.length === 0 && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No hay horarios libres en los próximos días. Comunícate con tu clínica y te ayudamos a
          encontrar uno.
        </p>
      )}

      {huecos.isSuccess && huecos.data.length > 0 && (
        <div className="mt-3 space-y-4">
          {agruparPorDia(huecos.data).map(([dia, delDia]) => (
            <div key={dia}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {dia}
              </p>
              <div className="flex flex-wrap gap-2">
                {delDia.map((h) => (
                  <button
                    key={h.inicio}
                    type="button"
                    onClick={() => setElegido(h.inicio)}
                    className={`rounded-lg border px-3 py-2 text-sm transition ${
                      elegido === h.inicio
                        ? 'border-brand-blue bg-brand-blue text-white'
                        : 'border-slate-300 text-slate-700 hover:border-brand-blue'
                    }`}
                  >
                    {hora(h.inicio)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmar.isError && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {confirmar.error instanceof ApiError && confirmar.error.status === 409
            ? 'Ese horario acaba de ocuparse. Elige otro, por favor.'
            : 'No se pudo cambiar la cita. Intenta de nuevo o comunícate con tu clínica.'}
        </p>
      )}

      <button
        type="button"
        disabled={!elegido || confirmar.isPending}
        onClick={() => elegido && confirmar.mutate(elegido)}
        className="mt-6 w-full rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-3 font-semibold text-white transition hover:opacity-95 disabled:opacity-40"
      >
        {confirmar.isPending ? 'Cambiando…' : 'Confirmar nuevo horario'}
      </button>
    </Tarjeta>
  );
}

function Tarjeta({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">{children}</div>
  );
}

/** Los huecos vienen ordenados, así que basta agrupar en un solo recorrido. */
function agruparPorDia(huecos: HuecoDisponible[]): [string, HuecoDisponible[]][] {
  const grupos = new Map<string, HuecoDisponible[]>();
  for (const h of huecos) {
    const dia = new Intl.DateTimeFormat('es-MX', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date(h.inicio));
    const lista = grupos.get(dia) ?? [];
    lista.push(h);
    grupos.set(dia, lista);
  }
  return [...grupos.entries()];
}

function fechaLarga(iso: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

function hora(iso: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}
