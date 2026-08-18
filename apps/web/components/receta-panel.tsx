'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HistorialPaciente, RecetaView } from '@healthflow/shared-types';
import { api, ApiError } from '../lib/api';
import { IconBan, IconPill, IconPrinter } from './icons';
import { Modal } from './modal';
import { RecetaModal } from './receta-modal';

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Historial de recetas del paciente.
 *
 * A diferencia de `OrdenesPlantillasPanel`, este panel NO devuelve null con la
 * lista vacía: aquél es exclusivo de podología y esconderlo evita una sección
 * irrelevante, pero recetar aplica a cualquier consultorio. Aquí la lista
 * vacía es información —este paciente no tiene recetas— y el estado vacío
 * lleva el botón para emitir la primera, sin necesidad de una cita abierta.
 */
export function RecetaPanel({
  token,
  patientId,
  pacienteNombre,
  historial,
}: {
  token: string;
  patientId: string;
  pacienteNombre?: string;
  historial?: HistorialPaciente;
}) {
  const lista = useQuery({
    queryKey: ['recetas', patientId],
    queryFn: () => api.listarRecetas(token, patientId),
  });

  const [emitiendo, setEmitiendo] = useState(false);
  const [cancelando, setCancelando] = useState<RecetaView | null>(null);

  const recetas = lista.data ?? [];

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Recetas</h2>
        <button
          type="button"
          onClick={() => setEmitiendo(true)}
          className="flex items-center gap-1 text-xs font-medium text-brand-blue hover:underline"
        >
          <IconPill size={13} />
          Nueva receta
        </button>
      </div>

      {lista.isLoading ? (
        <p className="text-sm text-slate-400">Cargando…</p>
      ) : recetas.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 px-4 py-5 text-center text-sm text-slate-400">
          Este paciente no tiene recetas emitidas.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {recetas.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">
                  {r.folio}
                  <span className="ml-2 font-normal text-slate-400">{fecha(r.createdAt)}</span>
                </p>
                <p className="truncate text-xs text-slate-500">
                  {r.contenido.medicamentos.map((m) => m.denominacionGenerica).join(', ')}
                </p>
                {r.cancelacion && (
                  <p className="mt-0.5 text-xs text-red-700">
                    Cancelada — {r.cancelacion.motivo}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-4">
                {r.cancelacion ? (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
                    Cancelada
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCancelando(r)}
                    className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-red-600"
                  >
                    <IconBan size={13} />
                    Cancelar
                  </button>
                )}
                {/* Se puede imprimir aunque esté cancelada: la hoja lleva la
                    marca de cancelación, y ocultarla no borra el papel que ya
                    tiene el paciente. */}
                <a
                  href={`/recetas/${r.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs font-medium text-brand-blue hover:underline"
                >
                  <IconPrinter size={13} />
                  Imprimir
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}

      {emitiendo && (
        <RecetaModal
          token={token}
          patientId={patientId}
          pacienteNombre={pacienteNombre}
          historial={historial}
          onClose={() => setEmitiendo(false)}
        />
      )}

      {cancelando && (
        <CancelarRecetaModal
          token={token}
          patientId={patientId}
          receta={cancelando}
          onClose={() => setCancelando(null)}
        />
      )}
    </section>
  );
}

function CancelarRecetaModal({
  token,
  patientId,
  receta,
  onClose,
}: {
  token: string;
  patientId: string;
  receta: RecetaView;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState('');

  const cancelar = useMutation({
    mutationFn: () => api.cancelarReceta(token, receta.id, { motivo }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recetas', patientId] });
      onClose();
    },
  });

  return (
    <Modal titulo="Cancelar receta" subtitulo={receta.folio} onClose={onClose}>
      <p className="mb-3 text-sm leading-relaxed text-slate-600">
        La receta no se borra: queda en el expediente marcada como cancelada, porque el paciente
        puede tener el papel en la mano y la farmacia una copia. El motivo se registra en la
        bitácora.
      </p>

      <label className="mb-4 block text-sm">
        <span className="mb-1 block font-medium text-slate-600">Motivo</span>
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={3}
          placeholder="Dosis incorrecta, el paciente reportó una alergia…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue"
        />
      </label>

      {cancelar.error && (
        <p className="mb-3 text-sm text-red-700">
          {cancelar.error instanceof ApiError ? cancelar.error.message : 'Error de conexión'}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:border-slate-400"
        >
          Volver
        </button>
        <button
          type="button"
          // 5 caracteres es el mínimo que exige el DTO: "x" no le dice nada a
          // quien lea el expediente en dos años.
          disabled={motivo.trim().length < 5 || cancelar.isPending}
          onClick={() => cancelar.mutate()}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {cancelar.isPending ? 'Cancelando…' : 'Cancelar receta'}
        </button>
      </div>
    </Modal>
  );
}
