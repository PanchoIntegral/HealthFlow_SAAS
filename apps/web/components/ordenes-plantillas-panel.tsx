'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { IconClipboardList, IconPrinter } from './icons';
import { OrdenPlantillasModal } from './orden-plantillas-modal';

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Lista de órdenes de plantillas del paciente. Cada una se puede abrir para
 * seguir llenándola —no solo para imprimirla— con el MISMO modal que usa la
 * consulta (`orden-plantillas-modal.tsx`), abierto por el id de la orden en
 * vez de por una cita: es lo que hace que "guardarse en el expediente" sea
 * cierto de verdad. Antes solo se podía editar desde la consulta que la
 * originó; si el médico salía de ahí, la orden quedaba congelada hasta la
 * próxima visita del paciente.
 *
 * Se dibuja a sí mismo (sección + encabezado) y devuelve null si no hay nada,
 * en vez de que la página de arriba decida con un flag de tenant nuevo
 * (`clinicaDental` tiene uno; esto no lo necesita): la sección es irrelevante
 * para el 100% de los pacientes de una clínica que no hace podología, y basta
 * con que la lista venga vacía para esos casos. Ningún paciente ve una
 * sección vacía que no le corresponde.
 */
export function OrdenesPlantillasPanel({ token, patientId }: { token: string; patientId: string }) {
  const lista = useQuery({
    queryKey: ['ordenes-plantillas', patientId],
    queryFn: () => api.listarOrdenesPlantillas(token, patientId),
  });

  const [editando, setEditando] = useState<string | null>(null);

  const ordenes = lista.data ?? [];
  if (!lista.isLoading && ordenes.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-3 font-semibold">Órdenes de plantillas</h2>
      {lista.isLoading ? (
        <p className="text-sm text-slate-400">Cargando…</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {ordenes.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="font-medium">{fecha(o.createdAt)}</p>
                <p className="text-xs text-slate-400">
                  {o.contenido.diagnosis || 'Sin diagnóstico capturado'}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    o.estatus === 'completada'
                      ? 'bg-emerald-100 text-emerald-800'
                      : o.estatus === 'cancelada'
                        ? 'bg-slate-100 text-slate-500'
                        : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {o.estatus === 'completada' ? 'Completada' : o.estatus === 'cancelada' ? 'Cancelada' : 'Borrador'}
                </span>
                <button
                  type="button"
                  onClick={() => setEditando(o.id)}
                  className="flex items-center gap-1 text-xs font-medium text-brand-blue hover:underline"
                >
                  <IconClipboardList size={13} />
                  {o.estatus === 'borrador' ? 'Llenar' : 'Ver / editar'}
                </button>
                <a
                  href={`/ordenes-plantillas/${o.id}`}
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

      {editando && (
        <OrdenPlantillasModal token={token} ordenId={editando} onClose={() => setEditando(null)} />
      )}
    </section>
  );
}
