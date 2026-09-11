'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ModuloView } from '@healthflow/shared-types';
import { api, ApiError } from '../lib/api';
import { useModulos } from '../lib/modulos';

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Módulos de la clínica. Lo que el titular controla aquí es UN eje —si quiere
 * usarlos—, no si los tiene contratados; por eso cada renglón dice en qué
 * estado está y quién puede cambiarlo.
 *
 * La distinción importa comercialmente: "no está incluido en tu plan" es una
 * conversación de ventas y "actívalo aquí" es de soporte. Un solo "no
 * disponible" para las dos cosas hace que el usuario escriba al buzón
 * equivocado.
 */
export function ModulosSeccion({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const lista = useModulos(token);
  const [error, setError] = useState<string | null>(null);
  const [cambiando, setCambiando] = useState<string | null>(null);

  const cambiar = useMutation({
    mutationFn: ({ flag, habilitado }: { flag: string; habilitado: boolean }) =>
      api.cambiarModulo(token, flag, habilitado),
    onMutate: ({ flag }) => {
      setCambiando(flag);
      setError(null);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['modulos'] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo cambiar el módulo'),
    onSettled: () => setCambiando(null),
  });

  if (lista.isLoading) return <p className="text-sm text-slate-400">Cargando módulos…</p>;
  if (lista.isError) return <p className="text-sm text-red-600">No se pudieron cargar los módulos.</p>;

  const modulos = lista.data ?? [];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="mb-4 text-sm text-slate-600">
        Enciende solo lo que vayas a usar. Apagar un módulo esconde sus pantallas, pero{' '}
        <strong>no borra nada</strong>: la información vuelve intacta si lo vuelves a encender.
      </p>

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <ul className="divide-y divide-slate-100">
        {modulos.map((m: ModuloView) => (
          <li key={m.flag} className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800">{m.nombre}</p>
              <p className="text-xs text-slate-500">{descripcion(m)}</p>
            </div>
            {m.contratado && m.rollout ? (
              <button
                type="button"
                role="switch"
                aria-checked={m.configuracion}
                aria-label={`${m.configuracion ? 'Desactivar' : 'Activar'} ${m.nombre}`}
                disabled={cambiando !== null}
                onClick={() => cambiar.mutate({ flag: m.flag, habilitado: !m.configuracion })}
                className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
                  m.configuracion ? 'bg-brand-green' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                    m.configuracion ? 'left-[22px]' : 'left-0.5'
                  }`}
                />
              </button>
            ) : (
              // Sin interruptor cuando no hay nada que el titular pueda hacer:
              // un control deshabilitado invita a pelearse con él.
              <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {m.contratado ? 'No disponible' : 'No incluido'}
              </span>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs text-slate-400">
        ¿Te falta un módulo? Los que no están incluidos en tu plan se contratan con nosotros.
      </p>
    </div>
  );
}

function descripcion(m: ModuloView): string {
  if (!m.contratado) return 'No incluido en tu plan';
  if (!m.rollout) return 'En mantenimiento; lo habilitamos en breve';
  if (m.razon === 'suscripcion') return 'En pausa mientras se regulariza el pago';
  if (!m.configuracion) return 'Disponible, sin activar';
  const desde = m.configuradoAt ? ` desde el ${fecha(m.configuradoAt)}` : '';
  const prueba =
    m.fuente === 'trial' && m.vigenciaHasta ? ` · prueba hasta el ${fecha(m.vigenciaHasta)}` : '';
  return `Activo${desde}${prueba}`;
}
