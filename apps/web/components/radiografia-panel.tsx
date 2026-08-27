'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RadiografiaView } from '@healthflow/shared-types';
import { api } from '../lib/api';
import { SubirRadiografiasModal } from './subir-radiografias-modal';

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Galería de radiografías del paciente. La subida vive en
 * SubirRadiografiasModal (varias placas en una sola sesión) y NUNCA pasa por
 * nuestro API: el body JSON está limitado a 256kb a propósito, así que se pide
 * una URL prefirmada, el navegador sube el archivo DIRECTO a R2 con un PUT, y
 * solo entonces se confirma la metadata.
 */
export function RadiografiaPanel({
  token,
  patientId,
  puedeEliminar,
}: {
  token: string;
  patientId: string;
  /** Solo médico/admin ven el botón de eliminar (ver CASL: asistente sube pero no borra). */
  puedeEliminar: boolean;
}) {
  const queryClient = useQueryClient();
  const [modalAbierto, setModalAbierto] = useState(false);
  const [visor, setVisor] = useState<RadiografiaView | null>(null);

  const lista = useQuery({
    queryKey: ['radiografias', patientId],
    queryFn: () => api.listarRadiografias(token, patientId),
  });

  const refrescar = () => queryClient.invalidateQueries({ queryKey: ['radiografias', patientId] });

  const eliminar = useMutation({
    mutationFn: (id: string) => api.eliminarRadiografia(token, id),
    onSuccess: () => {
      refrescar();
      setVisor(null);
    },
  });

  if (lista.isLoading) return <p className="text-sm text-slate-400">Cargando radiografías…</p>;

  const radiografias = lista.data ?? [];

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
        {radiografias.map((r) => (
          <button
            key={r.id}
            onClick={() => setVisor(r)}
            className="aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-50 transition hover:border-brand-blue"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={r.url} alt="" className="h-full w-full object-cover" />
          </button>
        ))}

        <button
          onClick={() => setModalAbierto(true)}
          className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400 transition hover:border-brand-blue hover:text-brand-blue"
        >
          + Subir
        </button>
      </div>

      {radiografias.length === 0 && (
        <p className="mt-3 text-sm text-slate-400">Sin radiografías registradas.</p>
      )}

      {modalAbierto && (
        <SubirRadiografiasModal
          token={token}
          patientId={patientId}
          onClose={() => setModalAbierto(false)}
          onSubida={refrescar}
        />
      )}

      {visor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setVisor(null)}
        >
          <div className="max-h-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={visor.url} alt="" className="max-h-[80vh] rounded-lg object-contain" />
            <div className="mt-3 flex items-center justify-between text-sm text-slate-200">
              <span>
                {fecha(visor.createdAt)} · {visor.subidoPorNombre}
              </span>
              <div className="flex gap-3">
                {puedeEliminar && (
                  <button
                    onClick={() => eliminar.mutate(visor.id)}
                    disabled={eliminar.isPending}
                    className="text-red-400 hover:text-red-300 disabled:opacity-50"
                  >
                    {eliminar.isPending ? 'Eliminando…' : 'Eliminar'}
                  </button>
                )}
                <button onClick={() => setVisor(null)} className="hover:text-white">
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
