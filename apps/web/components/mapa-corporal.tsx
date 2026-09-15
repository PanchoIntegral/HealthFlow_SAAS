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
          {/* Cabeza, cuello y tronco con hombros, cintura y caderas diferenciados. */}
          <path d="M94 27 C85 32 82 43 84 56 C86 70 93 80 101 84 L101 96 L119 96 L119 84 C127 80 134 70 136 56 C138 43 135 32 126 27 C117 22 103 22 94 27 Z" />
          <path d="M101 84 L98 105 Q110 110 122 105 L119 84" />
          <path d="M88 102 C76 105 68 112 63 124 C59 135 58 151 60 169 L68 214 C70 232 77 246 88 253 C94 258 98 262 99 270 L121 270 C122 262 126 258 132 253 C143 246 150 232 152 214 L160 169 C162 151 161 135 157 124 C152 112 144 105 132 102 Q110 112 88 102 Z" />
          {/* Brazos separados del tórax: permiten señalar cara interna/externa. */}
          <path d="M66 119 C56 128 52 142 49 158 L33 235 C31 247 33 257 39 262 C44 266 49 263 52 256 L63 214 L72 165" />
          <path d="M154 119 C164 128 168 142 171 158 L187 235 C189 247 187 257 181 262 C176 266 171 263 168 256 L157 214 L148 165" />
          <path d="M39 258 C32 265 34 275 40 277 C46 278 49 272 51 266 M181 258 C188 265 186 275 180 277 C174 278 171 272 169 266" />
          {/* Muslos, rodillas, pantorrillas y tobillos en dos piezas anatómicas. */}
          <path d="M98 267 C93 285 92 302 94 319 L91 386 C90 404 94 418 102 426 L109 426 L109 318 L110 278 L111 318 L111 426 L118 426 C126 418 130 404 129 386 L126 319 C128 302 127 285 122 267 Z" />
          <path d="M101 423 C91 430 85 443 86 456 C87 463 96 466 110 461 L110 426 Z" />
          <path d="M119 423 C129 430 135 443 134 456 C133 463 124 466 110 461 L110 426 Z" />
        </g>

        <g className="pointer-events-none" fill="none" stroke="#b6c2cf" strokeWidth="0.9">
          {anterior ? (
            <>
              <path d="M95 49 Q110 54 125 49 M88 105 Q110 119 132 105 M78 132 Q110 145 142 132" />
              <path d="M110 109 L110 252 M85 160 Q110 173 135 160 M89 196 Q110 207 131 196 M97 255 Q110 262 123 255" />
              <path d="M94 337 Q101 341 108 338 M112 338 Q119 341 126 337 M93 390 Q101 395 108 392 M112 392 Q119 395 127 390" />
            </>
          ) : (
            <>
              <path d="M94 36 Q110 27 126 36 L131 49 Q110 42 89 49 Z" fill="#cbd5e1" stroke="none" />
              <path d="M88 105 Q110 117 132 105 M80 133 Q110 148 140 133 M110 109 L110 254" />
              <path d="M85 160 Q110 174 135 160 M89 198 Q110 209 131 198 M91 230 Q110 218 129 230 M96 255 Q110 263 124 255" />
              <path d="M94 338 Q101 343 108 340 M112 340 Q119 343 126 338 M93 390 Q101 395 108 392 M112 392 Q119 395 127 390" />
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
