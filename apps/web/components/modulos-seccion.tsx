'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FeatureFlagView } from '@healthflow/shared-types';
import { api, ApiError } from '../lib/api';
import { useModulos } from '../lib/modulos';

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Activación por clínica de los módulos que se liberan por etapas.
 *
 * Apagar uno NO borra nada: los datos siguen ahí y vuelven en cuanto se
 * encienda otra vez. Se dice en pantalla porque es justo la duda que frena a
 * alguien a probar un módulo nuevo.
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
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : 'No se pudo cambiar el módulo'),
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
        {modulos.map((m: FeatureFlagView) => (
          <li key={m.flag} className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800">{m.nombre}</p>
              <p className="text-xs text-slate-500">
                {m.habilitado
                  ? `Activo${m.habilitadoAt ? ` desde el ${fecha(m.habilitadoAt)}` : ''}`
                  : 'No activado'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={m.habilitado}
              aria-label={`${m.habilitado ? 'Desactivar' : 'Activar'} ${m.nombre}`}
              disabled={cambiando !== null}
              onClick={() => cambiar.mutate({ flag: m.flag, habilitado: !m.habilitado })}
              className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
                m.habilitado ? 'bg-brand-green' : 'bg-slate-300'
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                  m.habilitado ? 'left-[22px]' : 'left-0.5'
                }`}
              />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
