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

const ANCHO = 220;
const ALTO = 480;

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
            Selecciona el tipo y toca el sitio exacto. Las marcas se numeran para cotejarlas con la descripción clínica.
          </p>
        </>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-300 bg-[#fbfcfd] shadow-sm">
        <div className="border-b border-slate-200 bg-slate-100/80 px-3 py-2 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-700">Ubicación de la herida</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {readOnly ? 'Localización registrada en la nota clínica' : 'Marcar la lesión con un círculo numerado'}
          </p>
        </div>
        <div className="overflow-x-auto p-3 sm:p-4">
        <div className="mx-auto grid w-fit grid-cols-2 gap-3 sm:gap-6">
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
        <DetallesExtremidades />
        </div>
      </section>

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
    <figure className="m-0 w-[145px] sm:w-[205px]">
      <figcaption className="mb-1 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
        {ETIQUETA_VISTA_CORPORAL[vista]}
      </figcaption>
      <svg
        viewBox={`0 0 ${ANCHO} ${ALTO}`}
        className="h-auto w-full select-none rounded-xl border border-slate-200 bg-white"
        role="img"
        aria-label={`${ETIQUETA_VISTA_CORPORAL[vista]} con ${marcas.length} marcas`}
      >
        <text x="12" y="18" fontSize="9" fontWeight="700" fill="#64748b">Der.</text>
        <text x="208" y="18" textAnchor="end" fontSize="9" fontWeight="700" fill="#64748b">Izq.</text>
        <line x1="110" y1="25" x2="110" y2="463" stroke="#e2e8f0" strokeDasharray="3 5" />

        <g
          onClick={(evento) => onMarcar(vista, evento)}
          className={readOnly ? undefined : 'cursor-crosshair'}
          fill="#f4f7fa"
          stroke="#64748b"
          strokeWidth="1.45"
          strokeLinejoin="round"
        >
          <path d="M94 28 C84 34 82 49 85 63 C87 74 94 82 101 85 L101 98 L119 98 L119 85 C126 82 133 74 135 63 C138 49 136 34 126 28 C117 23 103 23 94 28 Z" />
          <path d="M101 88 L98 105 L122 105 L119 88" />
          <path d="M89 102 C76 106 67 116 64 134 C61 151 61 176 65 197 L73 236 C78 250 87 258 94 262 L92 292 L128 292 L126 262 C133 258 142 250 147 236 L155 197 C159 176 159 151 156 134 C153 116 144 106 131 102 C123 110 97 110 89 102 Z" />
          <path d="M67 117 C57 125 53 140 50 158 L34 241 C32 251 34 261 40 265 C46 267 51 264 53 258 L63 214 L72 165" />
          <path d="M153 117 C163 125 167 140 170 158 L186 241 C188 251 186 261 180 265 C174 267 169 264 167 258 L157 214 L148 165" />
          <path d="M37 257 C31 265 34 274 40 276 C45 277 48 272 50 266 M183 257 C189 265 186 274 180 276 C175 277 172 272 170 266" />
          <path d="M92 258 C87 280 87 302 89 320 L86 394 C86 411 91 425 100 430 L109 430 L109 322 L110 293 L111 322 L111 430 L120 430 C129 425 134 411 134 394 L131 320 C133 302 133 280 128 258 Z" />
          <path d="M91 426 C82 436 78 452 82 463 C85 468 99 469 110 464 L110 430 L100 430 Z" />
          <path d="M129 426 C138 436 142 452 138 463 C135 468 121 469 110 464 L110 430 L120 430 Z" />
        </g>

        <g className="pointer-events-none" fill="none" stroke="#b6c2cf" strokeWidth="0.9">
          {anterior ? (
            <>
              <path d="M94 49 Q110 55 126 49 M89 113 Q110 126 131 113 M78 138 Q110 149 142 138" />
              <path d="M110 108 L110 252 M86 170 Q110 180 134 170 M93 261 Q110 270 127 261" />
              <path d="M93 342 Q101 346 108 343 M112 343 Q120 346 127 342 M92 396 Q100 401 108 398 M112 398 Q120 401 128 396" />
            </>
          ) : (
            <>
              <path d="M94 37 Q110 27 126 37 L130 49 Q110 42 90 49 Z" fill="#cbd5e1" stroke="none" />
              <path d="M89 111 Q110 121 131 111 M81 141 Q110 156 139 141 M110 108 L110 258" />
              <path d="M88 177 Q110 189 132 177 M90 222 Q110 209 130 222 M92 247 Q110 258 128 247" />
              <path d="M92 343 Q100 348 108 345 M112 345 Q120 348 128 343 M92 396 Q100 401 108 398 M112 398 Q120 401 128 396" />
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
              <circle r="11" fill={color} fillOpacity="0.92" stroke="#fff" strokeWidth="2.5" />
              <text y="4" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">
                {numeroDe(marca.id)}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function DetallesExtremidades() {
  return (
    <div className="mx-auto mt-3 grid w-fit grid-cols-2 gap-x-6 border-t border-slate-200 pt-3 sm:gap-x-12">
      <figure className="m-0">
        <figcaption className="mb-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500">Manos</figcaption>
        <svg viewBox="0 0 150 58" className="h-auto w-[105px] sm:w-[130px]" aria-label="Referencia anatómica de manos">
          <g fill="#f4f7fa" stroke="#94a3b8" strokeWidth="1">
            <path d="M20 53 L17 31 L20 17 L24 34 L25 8 L29 8 L30 32 L32 4 L36 4 L36 32 L39 8 L43 9 L42 35 L48 20 L51 22 L45 43 Q39 54 30 54 Z" />
            <path d="M130 53 L133 31 L130 17 L126 34 L125 8 L121 8 L120 32 L118 4 L114 4 L114 32 L111 8 L107 9 L108 35 L102 20 L99 22 L105 43 Q111 54 120 54 Z" />
          </g>
        </svg>
      </figure>
      <figure className="m-0">
        <figcaption className="mb-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500">Pies · planta</figcaption>
        <svg viewBox="0 0 150 58" className="h-auto w-[105px] sm:w-[130px]" aria-label="Referencia anatómica de pies">
          <g fill="#f4f7fa" stroke="#94a3b8" strokeWidth="1">
            <path d="M31 4 C20 8 18 21 20 35 C21 49 28 55 39 54 C48 53 49 46 46 38 L40 11 C38 5 35 3 31 4 Z" />
            <path d="M119 4 C130 8 132 21 130 35 C129 49 122 55 111 54 C102 53 101 46 104 38 L110 11 C112 5 115 3 119 4 Z" />
            <path d="M25 13 L35 13 M115 13 L125 13 M23 22 L38 22 M112 22 L127 22" fill="none" />
          </g>
        </svg>
      </figure>
    </div>
  );
}
