'use client';

import { useState, type MouseEvent, type ReactNode } from 'react';
import {
  ETIQUETA_VISTA_CORPORAL,
  TIPOS_MARCA_CORPORAL,
  VISTAS_CUERPO_COMPLETO,
  VISTAS_PIES,
  sitioMarcaCorporal,
  tipoMarcaCorporalPorKey,
  type MapaCorporal as MapaCorporalData,
  type MarcaCorporal,
  type TipoMarcaCorporal,
  type VistaCorporal,
} from '@healthflow/shared-types';

/**
 * Mapa anatómico interactivo para heridas y estomas.
 *
 * Reproduce la hoja de papel de la clínica de heridas: cuatro siluetas de
 * cuerpo completo (lateral derecha, anterior, posterior, lateral izquierda) y
 * cuatro recuadros de pies (caras lateral/medial, dorso, talones, plantas).
 * Las vistas se muestran juntas para reducir errores de lateralidad.
 *
 * Cada clic se guarda como coordenada normalizada (0–1000) dentro del lienzo
 * de SU vista, no como píxeles: la localización sobrevive cambios de tamaño de
 * pantalla e impresión. Por eso cada vista declara su propio lienzo abajo y
 * los dibujos no deben moverse dentro de él sin migrar las marcas guardadas.
 */

interface Lienzo {
  ancho: number;
  alto: number;
  /** Radio del círculo numerado, en unidades del lienzo. */
  radio: number;
}

const LIENZO_CUERPO: Lienzo = { ancho: 220, alto: 480, radio: 11 };
const LIENZO_LATERAL: Lienzo = { ancho: 150, alto: 480, radio: 11 };
const LIENZO_PIES: Lienzo = { ancho: 200, alto: 110, radio: 7.5 };
const LIENZO_PIES_ALTO: Lienzo = { ancho: 200, alto: 124, radio: 7.5 };

const LIENZOS: Record<VistaCorporal, Lienzo> = {
  lateral_derecha: LIENZO_LATERAL,
  anterior: LIENZO_CUERPO,
  posterior: LIENZO_CUERPO,
  lateral_izquierda: LIENZO_LATERAL,
  pies_lateral: LIENZO_PIES_ALTO,
  pies_dorsal: LIENZO_PIES,
  pies_posterior: LIENZO_PIES,
  pies_plantar: LIENZO_PIES,
};

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
    const lienzo = LIENZOS[vista];

    const marca: MarcaCorporal = {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      vista,
      x: Math.round((local.x / lienzo.ancho) * 1000),
      y: Math.round((local.y / lienzo.alto) * 1000),
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

  const numeroDe = (id: string) => valor.marcas.findIndex((marca) => marca.id === id) + 1;
  const marcasDe = (vista: VistaCorporal) => valor.marcas.filter((marca) => marca.vista === vista);
  // En solo lectura (historial del paciente) las vistas vacías son ruido: en
  // papel se imprime la hoja entera, pero en pantalla lo que importa es dónde
  // estaba la lesión.
  const visible = (vista: VistaCorporal) => !readOnly || marcasDe(vista).length > 0;
  const cuerpoVisible = VISTAS_CUERPO_COMPLETO.filter(visible);
  const piesVisibles = VISTAS_PIES.filter(visible);

  const propsLienzo = { numeroDe, onMarcar: agregar, readOnly };

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

        <div className="p-3 sm:p-4">
          {cuerpoVisible.length > 0 && (
            <div className="mx-auto grid w-fit grid-cols-2 items-end justify-items-center gap-3 sm:gap-5 lg:grid-cols-4">
              {cuerpoVisible.map((vista) => (
                <Lienzo key={vista} vista={vista} marcas={marcasDe(vista)} {...propsLienzo}>
                  {vista === 'anterior' || vista === 'posterior' ? (
                    <SiluetaFrontal vista={vista} />
                  ) : (
                    <SiluetaLateral espejo={vista === 'lateral_izquierda'} />
                  )}
                </Lienzo>
              ))}
            </div>
          )}

          {piesVisibles.length > 0 && (
            <div className={cuerpoVisible.length > 0 ? 'mt-4 border-t border-slate-200 pt-3' : undefined}>
              <p className="mb-2 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                Pies
              </p>
              <div className="mx-auto grid max-w-[1120px] grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {piesVisibles.map((vista) => (
                  <Lienzo key={vista} vista={vista} marcas={marcasDe(vista)} {...propsLienzo}>
                    {vista === 'pies_lateral' && <PiesLateralMedial />}
                    {vista === 'pies_dorsal' && <PiesDorsoPlanta planta={false} />}
                    {vista === 'pies_plantar' && <PiesDorsoPlanta planta />}
                    {vista === 'pies_posterior' && <PiesTalones />}
                  </Lienzo>
                ))}
              </div>
            </div>
          )}
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
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white"
                    style={{ backgroundColor: tipo?.color ?? '#64748b' }}
                  >
                    {indice + 1}
                  </span>
                  <span>
                    {tipo?.label ?? marca.tipo} · {sitioMarcaCorporal(marca)}
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

// ── Lienzo genérico ────────────────────────────────────────────────

const ANCHO_CSS: Record<VistaCorporal, string> = {
  lateral_derecha: 'w-[100px] sm:w-[140px]',
  anterior: 'w-[145px] sm:w-[205px]',
  posterior: 'w-[145px] sm:w-[205px]',
  lateral_izquierda: 'w-[100px] sm:w-[140px]',
  pies_lateral: 'w-full',
  pies_dorsal: 'w-full',
  pies_posterior: 'w-full',
  pies_plantar: 'w-full',
};

/** En teléfono conviene ver primero anterior/posterior; en escritorio, el orden de la hoja. */
const ORDEN_CSS: Partial<Record<VistaCorporal, string>> = {
  lateral_derecha: 'order-3 lg:order-1',
  anterior: 'order-1 lg:order-2',
  posterior: 'order-2 lg:order-3',
  lateral_izquierda: 'order-4 lg:order-4',
};

function Lienzo({
  vista,
  marcas,
  numeroDe,
  onMarcar,
  readOnly,
  children,
}: {
  vista: VistaCorporal;
  marcas: MarcaCorporal[];
  numeroDe: (id: string) => number;
  onMarcar: (vista: VistaCorporal, evento: MouseEvent<SVGGElement>) => void;
  readOnly?: boolean;
  children: ReactNode;
}) {
  const { ancho, alto, radio } = LIENZOS[vista];
  const esPies = VISTAS_PIES.includes(vista);

  return (
    <figure className={`m-0 ${ANCHO_CSS[vista]} ${ORDEN_CSS[vista] ?? ''} ${esPies ? 'mx-auto max-w-[280px]' : ''}`}>
      <figcaption className="mb-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs">
        {ETIQUETA_VISTA_CORPORAL[vista]}
      </figcaption>
      <svg
        viewBox={`0 0 ${ancho} ${alto}`}
        className="h-auto w-full select-none rounded-xl border border-slate-200 bg-white"
        role="img"
        aria-label={`${ETIQUETA_VISTA_CORPORAL[vista]} con ${marcas.length} marcas`}
      >
        {/*
          El grupo clicable envuelve solo el dibujo: tocar el fondo blanco no
          crea marcas. Los grupos hijos llevan los trazos; el estilo de relleno
          y línea se hereda desde aquí para que todas las vistas se vean igual.
        */}
        <g
          onClick={(evento) => onMarcar(vista, evento)}
          className={readOnly ? undefined : 'cursor-crosshair'}
          fill="#f4f7fa"
          stroke="#64748b"
          strokeWidth={esPies ? 1.3 : 1.45}
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          {children}
        </g>

        {marcas.map((marca) => {
          const color = tipoMarcaCorporalPorKey(marca.tipo)?.color ?? '#64748b';
          return (
            <g
              key={marca.id}
              className="pointer-events-none"
              transform={`translate(${(marca.x / 1000) * ancho} ${(marca.y / 1000) * alto})`}
            >
              <circle r={radio} fill={color} fillOpacity="0.92" stroke="#fff" strokeWidth={radio > 9 ? 2.5 : 1.8} />
              <text y={radio > 9 ? 4 : 2.6} textAnchor="middle" fontSize={radio > 9 ? 10 : 7} fontWeight="700" fill="#fff">
                {numeroDe(marca.id)}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

// ── Trazos ──────────────────────────────────────────────────────────
//
// Las siluetas se dibujan como UN contorno cerrado (no piezas superpuestas)
// para que parezcan el dibujo de línea de la hoja impresa. Los detalles
// interiores (clavículas, rótulas, escápulas…) van en un grupo aparte, más
// tenue y sin eventos, solo como referencia para ubicar la lesión.

const DETALLE = { fill: 'none', stroke: '#b6c2cf', strokeWidth: 0.9 } as const;
const ETIQUETA = { fontSize: 9, fontWeight: 700, fill: '#64748b' } as const;
const PELO = { fill: '#cbd5e1', stroke: 'none' } as const;

type Segmento = readonly [number, number, number, number, number, number];

/**
 * Construye un contorno simétrico a partir de su mitad izquierda: garantiza
 * que ambos lados del cuerpo sean idénticos, que es lo que hace creíble una
 * silueta frontal.
 */
function contornoSimetrico(inicio: readonly [number, number], mitad: readonly Segmento[], ancho: number): string {
  let d = `M${inicio[0]} ${inicio[1]}`;
  for (const s of mitad) d += `C${s[0]} ${s[1]} ${s[2]} ${s[3]} ${s[4]} ${s[5]}`;
  const puntos = [inicio, ...mitad.map((s) => [s[4], s[5]] as const)];
  for (let i = mitad.length - 1; i >= 0; i--) {
    const s = mitad[i]!;
    const fin = puntos[i]!;
    d += `C${ancho - s[2]} ${s[3]} ${ancho - s[0]} ${s[1]} ${ancho - fin[0]} ${fin[1]}`;
  }
  return `${d}Z`;
}

/** Mitad izquierda del lienzo (lado derecho del paciente en la vista anterior), de coronilla a entrepierna. */
const MITAD_CUERPO: readonly Segmento[] = [
  [96, 22, 87, 34, 87, 50], // cráneo
  [87, 63, 92, 74, 100, 80], // mandíbula → cuello
  [100, 86, 100, 92, 100, 94],
  [100, 97, 95, 100, 88, 102], // base del cuello
  [78, 104, 66, 107, 58, 115], // trapecio → acromion
  [51, 121, 49, 133, 50, 146], // deltoides
  [50, 165, 47, 188, 45, 208], // brazo → codo
  [43, 228, 41, 252, 40, 273], // antebrazo → muñeca
  [39, 279, 38, 284, 37, 289],
  [33, 294, 30, 301, 32, 305], // pulgar
  [34, 307, 38, 304, 41, 299],
  [41, 309, 43, 319, 47, 323], // dedos
  [52, 326, 57, 323, 58, 315],
  [59, 301, 58, 286, 57, 275], // muñeca interna
  [58, 252, 60, 230, 63, 210], // codo interno
  [66, 190, 68, 165, 69, 146], // axila
  [71, 150, 74, 160, 75, 175], // tórax
  [76, 190, 76, 205, 72, 220], // cintura
  [66, 232, 63, 246, 63, 262], // cadera
  [64, 282, 67, 302, 71, 326], // muslo
  [74, 340, 77, 352, 78, 362], // rodilla
  [77, 372, 76, 384, 76, 396], // pantorrilla
  [77, 410, 83, 421, 88, 430], // maléolo lateral
  [84, 438, 82, 448, 82, 456],
  [82, 464, 88, 468, 96, 467], // pie
  [102, 467, 106, 466, 108, 462],
  [106, 455, 104, 445, 102, 434], // maléolo medial
  [100, 420, 97, 408, 97, 392],
  [97, 376, 98, 362, 100, 350], // rodilla interna
  [102, 335, 104, 315, 105, 300],
  [106, 290, 108, 282, 110, 278], // entrepierna
];

const CONTORNO_CUERPO = contornoSimetrico([110, 22], MITAD_CUERPO, LIENZO_CUERPO.ancho);

const DETALLE_ANTERIOR = [
  'M66 113 Q90 116 108 109 M154 113 Q130 116 112 109 M107 108 Q110 112 113 108', // clavículas
  'M76 160 Q92 174 108 160 M144 160 Q128 174 112 160 M110 162 L110 250', // tórax y línea alba
  'M108 224 Q110 228 112 224', // ombligo
  'M68 236 Q92 262 110 280 M152 236 Q128 262 110 280', // pliegues inguinales
  'M83 352 Q89 344 95 352 Q89 362 83 352 M125 352 Q131 344 137 352 Q131 362 125 352', // rótulas
  'M90 433 Q94 436 97 433 M123 433 Q126 436 130 433', // tobillos
  'M88 460 L88 466 M94 459 L94 467 M100 459 L100 466 M132 460 L132 466 M126 459 L126 467 M120 459 L120 466', // dedos
].join(' ');

const DETALLE_POSTERIOR = [
  'M110 100 L110 252', // columna
  'M98 122 C90 134 86 150 92 166 M122 122 C130 134 134 150 128 166', // escápulas
  'M42 206 Q46 212 50 206 M178 206 Q174 212 170 206', // codos
  'M70 288 Q88 304 106 292 M150 288 Q132 304 114 292', // pliegues glúteos
  'M83 352 Q90 357 98 352 M137 352 Q130 357 122 352', // huecos poplíteos
  'M86 380 Q88 400 88 418 M134 380 Q132 400 132 418', // pantorrillas
  'M89 432 L89 452 M131 432 L131 452', // tendones de Aquiles
].join(' ');

const PELO_POSTERIOR =
  'M87 50 C87 34 96 22 110 22 C124 22 133 34 133 50 C133 62 128 72 122 76 Q110 70 98 76 C92 72 87 62 87 50 Z';

function SiluetaFrontal({ vista }: { vista: 'anterior' | 'posterior' }) {
  // Vista posterior = el paciente de espaldas: su lado derecho queda a la
  // DERECHA del lienzo. Las etiquetas deben coincidir con `ladoMarcaCorporal`.
  const anterior = vista === 'anterior';
  return (
    <>
      <text x="12" y="18" {...ETIQUETA} stroke="none">
        {anterior ? 'Der.' : 'Izq.'}
      </text>
      <text x="208" y="18" textAnchor="end" {...ETIQUETA} stroke="none">
        {anterior ? 'Izq.' : 'Der.'}
      </text>
      <line x1="110" y1="25" x2="110" y2="472" stroke="#e2e8f0" strokeDasharray="3 5" />
      <path d={CONTORNO_CUERPO} />
      {vista === 'posterior' && <path d={PELO_POSTERIOR} {...PELO} />}
      <path d={vista === 'anterior' ? DETALLE_ANTERIOR : DETALLE_POSTERIOR} {...DETALLE} />
    </>
  );
}

/** Perfil derecho: el paciente mira hacia la izquierda del lienzo. */
const CONTORNO_LATERAL =
  'M72 22 C60 24 53 34 52 44 C48 52 46 58 45 62 C44 66 48 68 50 69 C51 72 50 75 51 77 C53 80 56 82 57 84 C60 88 66 90 70 92 C71 98 70 104 70 108 C64 116 58 126 56 140 C55 160 57 180 59 200 C60 218 62 236 62 252 C62 262 64 270 66 276 C66 290 68 320 68 342 C67 350 68 360 70 366 C74 385 78 410 79 430 C74 438 62 446 48 452 C40 455 34 458 32 462 C31 466 36 468 44 468 L96 468 C104 468 108 462 106 454 C104 446 100 438 98 430 C100 415 106 400 108 388 C108 372 102 360 98 352 C100 335 106 315 110 300 C114 285 118 272 118 258 C117 242 110 232 104 222 C100 205 100 190 103 175 C106 160 110 140 109 125 C108 115 100 108 94 100 C92 92 94 84 96 78 C102 72 106 60 104 48 C102 32 90 22 72 22 Z';
/** Brazo cercano, dibujado encima del tronco. */
const BRAZO_LATERAL =
  'M76 112 C84 106 98 108 104 118 C108 128 108 140 106 155 C104 175 102 195 102 210 C102 230 98 252 94 272 C93 282 93 295 92 305 C92 315 90 322 86 324 C80 325 76 320 76 310 C76 295 76 282 76 272 C76 255 78 235 80 212 C80 195 78 170 78 150 C78 135 76 124 76 112 Z';
const PELO_LATERAL = 'M54 42 C58 28 86 16 102 38 C110 50 108 72 98 88 C96 80 94 70 90 62 C86 54 76 46 64 44 Z';
const OREJA_LATERAL = 'M84 52 C90 49 93 57 89 66 C86 69 82 65 84 58';
const DETALLE_LATERAL = 'M56 54 L62 55 M60 300 Q66 292 66 284 M86 428 Q90 432 88 438 M40 458 L38 466 M96 350 Q102 354 106 350';

function SiluetaLateral({ espejo }: { espejo: boolean }) {
  return (
    <g transform={espejo ? `translate(${LIENZO_LATERAL.ancho} 0) scale(-1 1)` : undefined}>
      <path d={CONTORNO_LATERAL} />
      <path d={PELO_LATERAL} {...PELO} />
      <path d={OREJA_LATERAL} />
      <path d={BRAZO_LATERAL} />
      <path d={DETALLE_LATERAL} {...DETALLE} />
    </g>
  );
}

// Pies: se dibuja el pie DERECHO y el izquierdo es su reflejo, lo que evita el
// bug clásico de estos esquemas (dos pies derechos).

const PIE_DORSAL =
  'M47 16 C46 30 46 42 44 54 C42 66 40 78 39 88 C37 97 13 97 11 88 C9 76 8 62 8 50 C8 38 6 28 6 22 C5 16 13 13 14 18 C14 11 21 10 22 15 C22 8 29 7 30 12 C30 5 37 4 38 9 C39 1 48 2 47 16 Z';
const PIE_PLANTAR =
  'M47 16 C47 28 44 40 38 52 C34 62 36 74 39 86 C38 97 13 97 11 88 C9 76 8 62 8 50 C8 38 6 28 6 22 C5 16 13 13 14 18 C14 11 21 10 22 15 C22 8 29 7 30 12 C30 5 37 4 38 9 C39 1 48 2 47 16 Z';
const DETALLE_DORSAL = 'M14 18 L15 25 M22 15 L23 22 M30 12 L31 19 M38 9 L39 17';
const DETALLE_PLANTAR = 'M12 80 Q25 72 38 82 M10 36 Q26 30 44 34';

function PiesDorsoPlanta({ planta }: { planta: boolean }) {
  const pie = planta ? PIE_PLANTAR : PIE_DORSAL;
  const detalle = planta ? DETALLE_PLANTAR : DETALLE_DORSAL;
  return (
    <>
      <EtiquetasLado izquierda="Der." derecha="Izq." />
      <g transform="translate(50 6)">
        <path d={pie} />
        <path d={detalle} {...DETALLE} />
      </g>
      <g transform="translate(150 6) scale(-1 1)">
        <path d={pie} />
        <path d={detalle} {...DETALLE} />
      </g>
    </>
  );
}

/** Pie derecho visto por fuera (punta hacia la izquierda). */
const PIE_CARA_LATERAL =
  'M52 0 L76 0 C75 8 74 14 76 20 C80 26 86 32 84 38 C82 44 76 44 70 44 L30 44 C20 44 12 43 8 39 C5 35 8 31 14 30 C24 29 34 27 42 22 C48 19 52 16 54 12 C55 8 53 4 52 0 Z';
/** Pie derecho visto por dentro (punta hacia la derecha), con arco plantar. */
const PIE_CARA_MEDIAL =
  'M8 0 L32 0 C31 4 30 8 31 12 C34 17 40 20 48 23 C58 27 68 29 74 31 C78 33 78 38 74 41 C70 44 62 44 52 44 L46 44 C38 44 32 40 26 38 C20 36 14 38 12 42 C10 44 6 44 3 41 C0 36 2 28 5 22 C8 16 9 8 8 0 Z';

function PiesLateralMedial() {
  return (
    <>
      <EtiquetasLado izquierda="Der." derecha="Izq." />
      <text x="100" y="10" textAnchor="middle" fontSize="7" fill="#94a3b8" stroke="none">
        CARA LATERAL
      </text>
      <text x="100" y="66" textAnchor="middle" fontSize="7" fill="#94a3b8" stroke="none">
        CARA MEDIAL
      </text>
      {[false, true].map((espejo) => (
        <g key={String(espejo)} transform={espejo ? 'translate(188 14) scale(-1 1)' : 'translate(12 14)'}>
          <path d={PIE_CARA_LATERAL} />
          <circle cx="68" cy="14" r="3.5" {...DETALLE} />
          <path d="M18 33 C16 37 16 41 18 44" {...DETALLE} />
        </g>
      ))}
      {[false, true].map((espejo) => (
        <g key={String(espejo)} transform={espejo ? 'translate(188 70) scale(-1 1)' : 'translate(12 70)'}>
          <path d={PIE_CARA_MEDIAL} />
          <circle cx="18" cy="10" r="3.5" {...DETALLE} />
          <path d="M66 30 C68 34 68 40 66 44" {...DETALLE} />
        </g>
      ))}
    </>
  );
}

/** Pie derecho visto por detrás: maléolo medial más alto que el lateral. */
const PIE_TALON =
  'M5 0 L35 0 C35 20 34 40 33 56 C36 58 38 62 36 66 C35 74 34 82 30 86 C26 90 14 90 10 86 C6 82 5 74 5 66 C3 62 4 58 7 56 C6 40 5 20 5 0 Z';

function PiesTalones() {
  return (
    <>
      <EtiquetasLado izquierda="Izq." derecha="Der." />
      <g transform="translate(96 8) scale(-1 1)">
        <path d={PIE_TALON} />
        <path d="M20 40 L20 72" {...DETALLE} />
      </g>
      <g transform="translate(104 8)">
        <path d={PIE_TALON} />
        <path d="M20 40 L20 72" {...DETALLE} />
      </g>
    </>
  );
}

function EtiquetasLado({ izquierda, derecha }: { izquierda: string; derecha: string }) {
  return (
    <>
      <text x="6" y="10" {...ETIQUETA} stroke="none">
        {izquierda}
      </text>
      <text x="194" y="10" textAnchor="end" {...ETIQUETA} stroke="none">
        {derecha}
      </text>
    </>
  );
}
