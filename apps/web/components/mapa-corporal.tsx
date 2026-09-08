'use client';

import { useState, type MouseEvent } from 'react';
import {
  ETIQUETA_VISTA_CORPORAL,
  TIPOS_MARCA_CORPORAL,
  tipoMarcaCorporalPorKey,
  type MapaCorporal as MapaCorporalData,
  type MarcaCorporal,
  type TipoMarcaCorporal,
  type VistaCorporal,
} from '@healthflow/shared-types';

const ANCHO = 200;
const ALTO = 430;

/**
 * Mapa anatómico interactivo para heridas y estomas.
 *
 * Las vistas se muestran juntas para reducir errores de lateralidad. Cada
 * clic se guarda como coordenada normalizada (0–1000), no como píxeles: la
 * localización sobrevive cambios de tamaño de pantalla e impresión.
 */
export function MapaCorporal({
  valor,
  onChange,
  readOnly,
}: {
  valor: MapaCorporalData;
  onChange: (actualizar: (previo: MapaCorporalData) => MapaCorporalData) => void;
  readOnly?: boolean;
}) {
  const [tipoActivo, setTipoActivo] = useState<TipoMarcaCorporal>('herida');

  const agregar = (vista: VistaCorporal, evento: MouseEvent<SVGGElement>) => {
    if (readOnly) return;
    const svg = evento.currentTarget.ownerSVGElement;
    const matriz = svg?.getScreenCTM();
    if (!svg || !matriz) return;

    const punto = svg.createSVGPoint();
    punto.x = evento.clientX;
    punto.y = evento.clientY;
    const local = punto.matrixTransform(matriz.inverse());

    const marca: MarcaCorporal = {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      vista,
      x: Math.round((local.x / ANCHO) * 1000),
      y: Math.round((local.y / ALTO) * 1000),
      tipo: tipoActivo,
    };
    onChange((previo) => ({ ...previo, marcas: [...previo.marcas, marca] }));
  };

  const describir = (id: string, descripcion: string) =>
    onChange((previo) => ({
      ...previo,
      marcas: previo.marcas.map((marca) =>
        marca.id === id ? { ...marca, descripcion: descripcion || undefined } : marca,
      ),
    }));

  const eliminar = (id: string) =>
    onChange((previo) => ({
      ...previo,
      marcas: previo.marcas.filter((marca) => marca.id !== id),
    }));

  return (
    <div>
      {!readOnly && (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {TIPOS_MARCA_CORPORAL.map((tipo) => (
              <button
                key={tipo.key}
                type="button"
                onClick={() => setTipoActivo(tipo.key)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                  tipoActivo === tipo.key
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                }`}
              >
                <span
                  className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle ring-1 ring-white/50"
                  style={{ backgroundColor: tipo.color }}
                />
                {tipo.label}
              </button>
            ))}
          </div>
          <p className="mb-3 text-xs text-slate-500">
            Selecciona el tipo y toca el sitio exacto. Puedes registrar varias heridas o estomas.
          </p>
        </>
      )}

      <div className="overflow-x-auto pb-2">
        <div className="mx-auto grid w-fit grid-cols-2 gap-4 sm:gap-8">
          {(['anterior', 'posterior'] as const).map((vista) => (
            <Silueta
              key={vista}
              vista={vista}
              marcas={valor.marcas.filter((marca) => marca.vista === vista)}
              numeroDe={(id) => valor.marcas.findIndex((marca) => marca.id === id) + 1}
              onMarcar={agregar}
              readOnly={readOnly}
            />
          ))}
        </div>
      </div>

      {valor.marcas.length > 0 ? (
        <div className="mt-4 space-y-2">
          {valor.marcas.map((marca, indice) => {
            const tipo = tipoMarcaCorporalPorKey(marca.tipo);
            return (
              <div
                key={marca.id}
                className="grid items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 sm:grid-cols-[auto_1fr_auto]"
              >
                <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-full text-white"
                    style={{ backgroundColor: tipo?.color ?? '#64748b' }}
                  >
                    {indice + 1}
                  </span>
                  <span className="whitespace-nowrap">
                    {tipo?.label ?? marca.tipo} · {ETIQUETA_VISTA_CORPORAL[marca.vista]}
                  </span>
                </div>
                {readOnly ? (
                  <span className="text-sm text-slate-600">{marca.descripcion || 'Sin detalle adicional'}</span>
                ) : (
                  <input
                    value={marca.descripcion ?? ''}
                    onChange={(evento) => describir(marca.id, evento.target.value)}
                    placeholder="Sitio preciso, p. ej. maléolo medial derecho"
                    aria-label={`Descripción de la marca ${indice + 1}`}
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-blue"
                  />
                )}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => eliminar(marca.id)}
                    className="justify-self-start rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 sm:justify-self-end"
                    aria-label={`Eliminar marca ${indice + 1}`}
                  >
                    Eliminar
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Aún no hay una ubicación marcada.
        </p>
      )}

    </div>
  );
}

function Silueta({
  vista,
  marcas,
  numeroDe,
  onMarcar,
  readOnly,
}: {
  vista: VistaCorporal;
  marcas: MarcaCorporal[];
  numeroDe: (id: string) => number;
  onMarcar: (vista: VistaCorporal, evento: MouseEvent<SVGGElement>) => void;
  readOnly?: boolean;
}) {
  const anterior = vista === 'anterior';

  return (
    <figure className="m-0 w-[180px] sm:w-[220px]">
      <figcaption className="mb-1 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
        {ETIQUETA_VISTA_CORPORAL[vista]}
      </figcaption>
      <svg
        viewBox={`0 0 ${ANCHO} ${ALTO}`}
        className="h-auto w-full select-none rounded-xl border border-slate-200 bg-white"
        role="img"
        aria-label={`${ETIQUETA_VISTA_CORPORAL[vista]} con ${marcas.length} marcas`}
      >
        <text x="8" y="17" fontSize="8" fill="#64748b">{anterior ? 'Der.' : 'Izq.'}</text>
        <text x="192" y="17" textAnchor="end" fontSize="8" fill="#64748b">{anterior ? 'Izq.' : 'Der.'}</text>

        <g
          onClick={(evento) => onMarcar(vista, evento)}
          className={readOnly ? undefined : 'cursor-crosshair'}
          fill="#f8fafc"
          stroke="#94a3b8"
          strokeWidth="1.5"
        >
          <circle cx="100" cy="43" r="24" />
          <path d="M88 65 L87 79 Q100 85 113 79 L112 65 Z" />
          <path d="M73 78 Q100 69 127 78 Q137 103 137 151 Q133 183 124 210 L76 210 Q67 183 63 151 Q63 103 73 78 Z" />
          <path d="M72 82 Q57 88 49 115 L29 210 Q27 224 38 228 Q48 228 51 215 L72 135 Z" />
          <path d="M128 82 Q143 88 151 115 L171 210 Q173 224 162 228 Q152 228 149 215 L128 135 Z" />
          <ellipse cx="33" cy="238" rx="9" ry="15" />
          <ellipse cx="167" cy="238" rx="9" ry="15" />
          <path d="M77 207 Q72 239 75 287 L68 385 Q67 402 80 404 Q92 403 94 388 L100 282 L100 211 Z" />
          <path d="M123 207 Q128 239 125 287 L132 385 Q133 402 120 404 Q108 403 106 388 L100 282 L100 211 Z" />
          <path d="M67 398 Q60 414 70 419 L92 419 Q97 415 91 403 Z" />
          <path d="M133 398 Q140 414 130 419 L108 419 Q103 415 109 403 Z" />
        </g>

        <g className="pointer-events-none" fill="none" stroke="#cbd5e1" strokeWidth="1">
          {anterior ? (
            <>
              <path d="M91 43 Q100 48 109 43" />
              <circle cx="92" cy="38" r="1" fill="#94a3b8" />
              <circle cx="108" cy="38" r="1" fill="#94a3b8" />
              <path d="M100 84 L100 210 M76 121 Q100 130 124 121" />
              <circle cx="100" cy="164" r="2" />
            </>
          ) : (
            <>
              <path d="M100 80 L100 211 M76 111 Q87 102 98 116 M124 111 Q113 102 102 116" />
              <path d="M77 194 Q100 181 123 194 M78 220 Q88 231 99 220 M122 220 Q112 231 101 220" />
            </>
          )}
        </g>

        {marcas.map((marca) => {
          const color = tipoMarcaCorporalPorKey(marca.tipo)?.color ?? '#64748b';
          return (
            <g
              key={marca.id}
              className="pointer-events-none"
              transform={`translate(${(marca.x / 1000) * ANCHO} ${(marca.y / 1000) * ALTO})`}
            >
              <circle r="10" fill={color} fillOpacity="0.88" stroke="#fff" strokeWidth="2" />
              <text y="3" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff">
                {numeroDe(marca.id)}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
