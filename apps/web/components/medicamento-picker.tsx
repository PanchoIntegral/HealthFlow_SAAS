'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  esFraccionEmisible,
  ETIQUETAS_FRACCION,
  type MedicamentoCatalogo,
  type MedicamentoRecetado,
} from '@healthflow/shared-types';
import { api } from '../lib/api';
import { IconBan } from './icons';

/**
 * Autocompletado del catálogo de medicamentos, con escape hatch de texto
 * libre. Mismo patrón que el DiagnosticoPicker de la consulta: debounce
 * manual, useQuery habilitado a partir de 2 caracteres y dropdown absoluto.
 *
 * Los medicamentos de fracción I y II se MUESTRAN, deshabilitados y con el
 * motivo. Ocultarlos empujaría al médico a capturarlos por texto libre, que es
 * justo el camino donde el bloqueo del art. 226 no puede dispararse — el
 * backend sigue siendo la autoridad, pero enterarse aquí le ahorra llenar
 * siete campos para nada.
 */
export function MedicamentoPicker({
  token,
  onElegir,
}: {
  token: string;
  onElegir: (m: MedicamentoRecetado) => void;
}) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isFetching } = useQuery({
    queryKey: ['medicamentos', debounced],
    queryFn: () => api.buscarMedicamentos(token, debounced),
    enabled: debounced.trim().length >= 2,
  });

  const elegirDelCatalogo = (m: MedicamentoCatalogo) => {
    onElegir({
      clave: m.clave,
      denominacionGenerica: m.denominacionGenerica,
      denominacionDistintiva: null,
      // Presentación y vía se precargan del catálogo pero quedan editables:
      // el médico ajusta la dosis y a veces la vía al caso concreto.
      presentacion: m.presentacion,
      dosis: '',
      via: m.viaSugerida,
      frecuencia: '',
      duracion: '',
      indicaciones: null,
      fraccion: m.fraccion,
    });
    cerrar();
  };

  const elegirTextoLibre = () => {
    onElegir({
      clave: null,
      denominacionGenerica: q.trim(),
      denominacionDistintiva: null,
      presentacion: '',
      dosis: '',
      via: '',
      frecuencia: '',
      duracion: '',
      indicaciones: null,
      fraccion: null,
    });
    cerrar();
  };

  const cerrar = () => {
    setQ('');
    setDebounced('');
    setAbierto(false);
  };

  const resultados = data ?? [];
  const mostrarLista = abierto && debounced.trim().length >= 2;

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setAbierto(true);
        }}
        onFocus={() => setAbierto(true)}
        // onBlur diferido: sin el retraso, el blur cierra la lista antes de
        // que el click sobre una opción llegue a dispararse.
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        placeholder="Buscar medicamento por sustancia o grupo (paracetamol, antibiótico…)"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue"
      />

      {mostrarLista && (
        <ul className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {isFetching && resultados.length === 0 && (
            <li className="px-3 py-2 text-sm text-slate-400">Buscando…</li>
          )}

          {resultados.map((m) => {
            const emisible = esFraccionEmisible(m.fraccion);
            return (
              <li key={m.clave} className="border-b border-slate-100 last:border-0">
                <button
                  type="button"
                  disabled={!emisible}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => elegirDelCatalogo(m)}
                  className={
                    emisible
                      ? 'w-full px-3 py-2 text-left hover:bg-slate-50'
                      : 'w-full cursor-not-allowed px-3 py-2 text-left opacity-70'
                  }
                >
                  <span className="block text-sm font-medium text-slate-800">
                    {m.denominacionGenerica}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {m.formaFarmaceutica} · {m.presentacion}
                  </span>
                  {emisible ? (
                    <span className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                      {m.grupoTerapeutico}
                    </span>
                  ) : (
                    <span className="mt-1 inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-800">
                      <IconBan size={12} />
                      {ETIQUETAS_FRACCION[m.fraccion]}
                    </span>
                  )}
                </button>
              </li>
            );
          })}

          {/* Escape hatch: el catálogo es un subconjunto, y uno incompleto que
              bloquea al médico se convierte en la razón por la que deja de
              usar el módulo. */}
          <li className="border-t border-slate-200 bg-slate-50">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={elegirTextoLibre}
              className="w-full px-3 py-2 text-left text-sm text-brand-blue hover:bg-slate-100"
            >
              Usar «{q.trim()}» como medicamento fuera de catálogo
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
