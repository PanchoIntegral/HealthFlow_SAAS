'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { NuevaPartida, PatientSummary, PresupuestoView } from '@healthflow/shared-types';
import { api, ApiError } from '../lib/api';
import { Modal } from './modal';
import { EditorPartidas } from './presupuesto-panel';

/**
 * Alta de presupuesto en un modal, sin salir de donde esté el dentista.
 *
 * Con `paciente` fijo (p.ej. desde la consulta en curso) va directo al
 * formulario. Sin él (p.ej. desde el tablero de Presupuestos) primero pide
 * elegir un paciente — mismo patrón de búsqueda que el resto de la app.
 */
export function NuevoPresupuestoModal({
  token,
  paciente,
  piezasSugeridas,
  onClose,
  onCreado,
}: {
  token: string;
  paciente?: { id: string; nombre: string };
  piezasSugeridas?: string[];
  onClose: () => void;
  onCreado: (p: PresupuestoView) => void;
}) {
  const [elegido, setElegido] = useState(paciente ?? null);
  const [titulo, setTitulo] = useState('Plan de tratamiento');
  const [error, setError] = useState<string | null>(null);

  const crear = useMutation({
    mutationFn: (partidas: NuevaPartida[]) =>
      api.crearPresupuesto(token, {
        patientId: elegido!.id,
        titulo: titulo.trim() || 'Plan de tratamiento',
        partidas,
      }),
    onSuccess: (p) => {
      onCreado(p);
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo crear el presupuesto'),
  });

  return (
    <Modal
      titulo="Nuevo presupuesto"
      subtitulo={elegido ? elegido.nombre : 'Elige el paciente para empezar a cotizar.'}
      onClose={onClose}
      ancho="max-w-2xl"
    >
      {!elegido ? (
        <SelectorPaciente token={token} onElegir={setElegido} />
      ) : (
        <div className="space-y-4">
          {!paciente && (
            <button
              onClick={() => setElegido(null)}
              className="text-xs font-medium text-slate-500 hover:text-brand-blue"
            >
              ← Cambiar paciente
            </button>
          )}

          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">
              Título del presupuesto
            </span>
            <input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Plan de tratamiento"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue"
            />
          </label>

          <div>
            <span className="mb-1 block text-xs font-medium text-slate-500">Partidas</span>
            <EditorPartidas
              piezasIniciales={piezasSugeridas}
              guardando={crear.isPending}
              onGuardar={(partidas) => {
                setError(null);
                crear.mutate(partidas);
              }}
              onCancelar={onClose}
              labelGuardar="Crear presupuesto"
              labelGuardando="Creando…"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
    </Modal>
  );
}

function SelectorPaciente({
  token,
  onElegir,
}: {
  token: string;
  onElegir: (p: { id: string; nombre: string }) => void;
}) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Sin texto (o 1 letra) el backend regresa el directorio completo, igual que
  // "Expedientes": se ve la lista de entrada y el buscador solo va filtrando.
  const busqueda = useQuery({
    queryKey: ['pacientes-buscar', debounced],
    queryFn: () => api.searchPatients(token, debounced),
  });
  const resultados: PatientSummary[] = busqueda.data ?? [];

  return (
    <div>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar paciente por nombre o CURP…"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue"
      />
      <div className="mt-3 max-h-72 overflow-y-auto">
        {busqueda.isLoading && (
          <p className="px-1 py-4 text-center text-sm text-slate-400">Cargando pacientes…</p>
        )}
        {!busqueda.isLoading && resultados.length === 0 && (
          <p className="px-1 py-4 text-center text-sm text-slate-400">
            {debounced.trim() ? 'Sin pacientes con ese nombre.' : 'Sin pacientes registrados.'}
          </p>
        )}
        {resultados.length > 0 && (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
            {resultados.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => onElegir({ id: p.id, nombre: p.nombre })}
                  className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-slate-50"
                >
                  <span className="font-medium">{p.nombre}</span>
                  <span className="text-xs text-slate-400">{p.edad} años</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
