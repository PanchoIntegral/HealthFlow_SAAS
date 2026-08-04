'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConsentimientoView } from '@healthflow/shared-types';
import { api, ApiError } from '../lib/api';

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Consentimiento informado del paciente. A diferencia de PresupuestoPanel, no
 * hay estatus ni transición que ofrecer: cada tarjeta es un registro cerrado
 * desde que se creó, y el único formulario es el de alta.
 */
export function ConsentimientoPanel({ token, patientId }: { token: string; patientId: string }) {
  const queryClient = useQueryClient();
  const [creando, setCreando] = useState(false);
  const [expandido, setExpandido] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: ['consentimientos', patientId],
    queryFn: () => api.listarConsentimientos(token, patientId),
  });

  const [procedimiento, setProcedimiento] = useState('');
  const [contenido, setContenido] = useState('');
  const [error, setError] = useState<string | null>(null);

  const crear = useMutation({
    mutationFn: () => api.crearConsentimiento(token, { patientId, procedimiento, contenido }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['consentimientos', patientId] });
      setProcedimiento('');
      setContenido('');
      setCreando(false);
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo registrar'),
  });

  if (lista.isLoading) return <p className="text-sm text-slate-400">Cargando consentimientos…</p>;

  const consentimientos = lista.data ?? [];

  return (
    <div className="space-y-3">
      {consentimientos.map((c) => (
        <ConsentimientoCard
          key={c.id}
          c={c}
          expandido={expandido === c.id}
          onToggle={() => setExpandido(expandido === c.id ? null : c.id)}
        />
      ))}

      {consentimientos.length === 0 && !creando && (
        <p className="text-sm text-slate-400">Sin consentimientos registrados.</p>
      )}

      {creando ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">Procedimiento</span>
            <input
              value={procedimiento}
              onChange={(e) => setProcedimiento(e.target.value)}
              placeholder="p.ej. Extracción dental pieza 36"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">
              Riesgos, alternativas e indicaciones explicadas
            </span>
            <textarea
              value={contenido}
              onChange={(e) => setContenido(e.target.value)}
              rows={5}
              placeholder="Qué se le explicó al paciente sobre el procedimiento, sus riesgos y alternativas…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue"
            />
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={() => crear.mutate()}
              disabled={crear.isPending || !procedimiento.trim() || !contenido.trim()}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {crear.isPending ? 'Guardando…' : 'Registrar consentimiento'}
            </button>
            <button
              onClick={() => {
                setCreando(false);
                setError(null);
              }}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:border-slate-400"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setCreando(true)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:border-slate-400"
        >
          + Nuevo consentimiento
        </button>
      )}
    </div>
  );
}

function ConsentimientoCard({
  c,
  expandido,
  onToggle,
}: {
  c: ConsentimientoView;
  expandido: boolean;
  onToggle: () => void;
}) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <button onClick={onToggle} className="flex w-full items-center justify-between text-left">
        <div>
          <p className="text-sm font-semibold">{c.procedimiento}</p>
          <p className="text-xs text-slate-500">
            {fecha(c.createdAt)} · {c.doctorNombre}
          </p>
        </div>
        <span className="text-xs text-slate-400">{expandido ? 'Ocultar' : 'Ver detalle'}</span>
      </button>
      {expandido && (
        <p className="mt-3 whitespace-pre-wrap border-t border-slate-100 pt-3 text-sm text-slate-700">
          {c.contenido}
        </p>
      )}
    </article>
  );
}
