'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MIME_TYPES_RADIOGRAFIA, type MimeTypeRadiografia, type RadiografiaView } from '@healthflow/shared-types';
import { api, ApiError } from '../lib/api';
import { ErrorSubidaDirecta, subirArchivoDirecto } from '../lib/subida-directa';

/**
 * Traduce el fallo a algo que el usuario pueda accionar, y deja el detalle
 * técnico en la consola. Antes todo error no-ApiError caía en un genérico
 * "No se pudo subir la radiografía": el usuario no sabía si era su archivo o
 * la configuración del servidor, y soporte tampoco.
 */
function mensajeDeError(e: unknown): string {
  if (e instanceof ErrorSubidaDirecta) {
    console.error('[radiografias] subida fallida:', e.causa, e.detalle);
    return e.message;
  }
  if (e instanceof ApiError) return e.message;
  console.error('[radiografias] error inesperado al subir:', e);
  return 'No se pudo subir la radiografía';
}

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Galería de radiografías del paciente. La subida NUNCA pasa por nuestro API
 * (el body JSON está limitado a 256kb a propósito): se pide una URL
 * prefirmada, el navegador sube el archivo DIRECTO a R2 con un PUT, y solo
 * entonces se confirma la metadata.
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  async function onArchivoSeleccionado(file: File) {
    setError(null);
    if (!MIME_TYPES_RADIOGRAFIA.includes(file.type as MimeTypeRadiografia)) {
      setError('Solo se aceptan imágenes JPEG, PNG o WEBP.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('La imagen no puede superar 10MB.');
      return;
    }

    setSubiendo(true);
    try {
      const mimeType = file.type as MimeTypeRadiografia;
      const { uploadUrl, headers, storageKey } = await api.requestUploadUrl(token, {
        patientId,
        mimeType,
      });

      // Subida directa al storage, sin Authorization (el storage no sabe nada
      // de HealthFlow): la autorización va en la firma de la URL.
      await subirArchivoDirecto(uploadUrl, headers, file);

      await api.confirmRadiografia(token, { patientId, storageKey, mimeType });
      refrescar();
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setSubiendo(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

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

        <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400 hover:border-brand-blue hover:text-brand-blue">
          {subiendo ? 'Subiendo…' : '+ Subir'}
          <input
            ref={fileInputRef}
            type="file"
            accept={MIME_TYPES_RADIOGRAFIA.join(',')}
            disabled={subiendo}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onArchivoSeleccionado(file);
            }}
            className="hidden"
          />
        </label>
      </div>

      {radiografias.length === 0 && (
        <p className="mt-3 text-sm text-slate-400">Sin radiografías registradas.</p>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

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
