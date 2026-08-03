'use client';

import { useState } from 'react';
import {
  CARAS_DIENTE,
  ESTADOS_DENTALES,
  ETIQUETA_CARA,
  estadoDentalPorKey,
  piezasDeCuadrante,
  type CaraDiente,
  type MarcaDental,
  type Odontograma as OdontogramaData,
} from '@healthflow/shared-types';

/**
 * Odontograma interactivo en notación FDI.
 *
 * Disposición: como lo ve el dentista frente al paciente — arriba los
 * cuadrantes superiores (derecho del paciente a la izquierda de la pantalla),
 * abajo los inferiores. Cada diente se dibuja como cinco zonas (las cuatro
 * caras más la oclusal al centro), que es la forma en que se registra en papel
 * desde siempre; cambiarla obligaría al dentista a reaprender lo que ya sabe.
 */
export function Odontograma({
  valor,
  onChange,
  readOnly,
}: {
  valor: OdontogramaData;
  /**
   * Recibe un ACTUALIZADOR, no el valor ya calculado. Es deliberado: marcar
   * varias caras seguidas dispara varios onChange dentro del mismo ciclo de
   * React, y si cada uno partiera del `valor` de props (ya desactualizado) el
   * último pisaría a los anteriores. En una nota clínica eso significa perder
   * un hallazgo porque el dentista marcó rápido.
   */
  onChange: (actualizar: (previo: OdontogramaData) => OdontogramaData) => void;
  readOnly?: boolean;
}) {
  const [estadoActivo, setEstadoActivo] = useState<string>('caries');
  const estado = estadoDentalPorKey(estadoActivo);
  const aplicaAPiezaCompleta = estado?.piezaCompleta === true;

  const marcaDe = (pieza: string, cara?: CaraDiente) =>
    valor.marcas.find((m) => m.pieza === pieza && m.cara === cara);

  /** Alterna la marca: volver a pintar lo mismo la borra (es el "deshacer"). */
  const alternar = (pieza: string, cara?: CaraDiente) => {
    if (readOnly) return;
    onChange((previo) => {
      const existente = previo.marcas.find((m) => m.pieza === pieza && m.cara === cara);
      const marcas = previo.marcas.filter((m) => !(m.pieza === pieza && m.cara === cara));
      if (existente?.estado !== estadoActivo) {
        marcas.push({ pieza, cara, estado: estadoActivo } satisfies MarcaDental);
      }
      return { ...previo, marcas };
    });
  };

  const cuadrantesSuperiores = valor.denticion === 'temporal' ? [5, 6] : [1, 2];
  const cuadrantesInferiores = valor.denticion === 'temporal' ? [8, 7] : [4, 3];

  return (
    <div>
      {!readOnly && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {ESTADOS_DENTALES.map((e) => (
            <button
              key={e.key}
              type="button"
              onClick={() => setEstadoActivo(e.key)}
              className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                estadoActivo === e.key
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 bg-white hover:border-slate-400'
              }`}
            >
              <span
                className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle"
                style={{ backgroundColor: e.color }}
              />
              {e.label}
            </button>
          ))}
        </div>
      )}

      {!readOnly && (
        <p className="mb-3 text-xs text-slate-500">
          {aplicaAPiezaCompleta
            ? 'Toca cualquier parte del diente: este estado aplica a la pieza completa.'
            : 'Toca la cara del diente a marcar. Volver a tocarla con el mismo estado la borra.'}
        </p>
      )}

      {/* Scroll propio: la arcada tiene un ancho mínimo y el resto de la
          página NO debe desplazarse en horizontal por su culpa. */}
      <div className="overflow-x-auto pb-2">
        <div
          className="relative mx-auto"
          style={{ width: ANCHO, height: ALTO }}
        >
          {/* Referencia de lados. Convención universal: el odontograma se
              dibuja como el dentista ve al paciente, así que la izquierda de
              la pantalla es la DERECHA del paciente. Rotularlo evita el error
              clásico de tratar la pieza espejo. */}
          <span className="absolute left-0 top-0 text-[10px] font-medium uppercase tracking-wide text-slate-400">
            Der. paciente
          </span>
          <span className="absolute right-0 top-0 text-[10px] font-medium uppercase tracking-wide text-slate-400">
            Izq. paciente
          </span>

          <div
            className="absolute inset-x-0 border-t border-dashed border-slate-200"
            style={{ top: Y_DIVISORIA }}
          />

          <Arcada
            piezas={piezasDeArcada(cuadrantesSuperiores)}
            superior
            marcaDe={marcaDe}
            onTocar={alternar}
            piezaCompleta={aplicaAPiezaCompleta}
          />
          <Arcada
            piezas={piezasDeArcada(cuadrantesInferiores)}
            superior={false}
            marcaDe={marcaDe}
            onTocar={alternar}
            piezaCompleta={aplicaAPiezaCompleta}
          />
        </div>
      </div>

      <ResumenMarcas marcas={valor.marcas} />
    </div>
  );
}

// ── Geometría de las arcadas ─────────────────────────────────────
// Los dientes se colocan sobre una elipse en vez de una fila, que es como se
// dibuja el odontograma en papel y como lo espera cualquier dentista.

const ANCHO = 360;
const ALTO = 495;
const RX = 150;
const RY = 168;
/** Separación mínima entre coronas contiguas. */
const HOLGURA = 4;

type TipoDiente = 'incisivo' | 'canino' | 'premolar' | 'molar';

/**
 * Morfología de la corona vista desde oclusal, que es la perspectiva del
 * odontograma. Las medidas son proporcionales, no milímetros reales.
 *
 * `ancho` es mesio-distal y `alto` vestíbulo-palatino. Por eso los incisivos
 * salen anchos y planos: desde arriba son una hoja. Y por eso los molares son
 * los más grandes en las dos direcciones.
 */
const MORFOLOGIA: Record<number, { ancho: number; alto: number; tipo: TipoDiente }> = {
  1: { ancho: 22, alto: 14, tipo: 'incisivo' }, // incisivo central
  2: { ancho: 19, alto: 13, tipo: 'incisivo' }, // incisivo lateral
  3: { ancho: 20, alto: 19, tipo: 'canino' },
  4: { ancho: 22, alto: 21, tipo: 'premolar' },
  5: { ancho: 22, alto: 21, tipo: 'premolar' },
  6: { ancho: 28, alto: 25, tipo: 'molar' }, // primer molar, el más grande
  7: { ancho: 27, alto: 24, tipo: 'molar' },
  8: { ancho: 25, alto: 23, tipo: 'molar' }, // tercer molar (del juicio)
};

/**
 * Contorno de cada tipo. El canino es rombal (una sola cúspide, que apunta
 * hacia vestibular), el premolar ovalado y el molar cuadrangular: es el rasgo
 * por el que un dentista identifica la pieza de un vistazo, sin leer el número.
 */
const CONTORNO: Record<TipoDiente, string> = {
  incisivo: '3px',
  canino: '55% 55% 22% 22%',
  premolar: '45%',
  molar: '5px',
};

function morfologiaDe(pieza: string): { ancho: number; alto: number; tipo: TipoDiente } {
  const cuadrante = Number(pieza[0]);
  const posicion = Number(pieza[1]);
  const base = MORFOLOGIA[posicion] ?? MORFOLOGIA[1]!;

  // En la dentición temporal las posiciones 4 y 5 son MOLARES: los niños no
  // tienen premolares, y dibujarlos ovalados confundiría al dentista.
  if (cuadrante >= 5 && posicion >= 4) {
    return { ancho: 24, alto: 22, tipo: 'molar' };
  }
  return base;
}
/** Línea que separa las dos arcadas, como en cualquier odontograma de papel. */
const Y_DIVISORIA = 241;

/**
 * Cada arcada es MEDIA elipse exacta (180°→0° arriba, 180°→360° abajo) y los
 * centros están separados 82 px.
 *
 * Ambas cosas importan: con un barrido mayor a 180° las muelas del juicio
 * bajan por debajo de la horizontal, y si además los centros quedan cerca, las
 * puntas de las dos arcadas se tocan y el dibujo deja de leerse como una boca
 * abierta para volverse un anillo cerrado.
 */
const ARCADAS = {
  superior: { centroY: 200, desde: 180, hasta: 0 },
  inferior: { centroY: 282, desde: 180, hasta: 360 },
} as const;

/**
 * Piezas de una arcada, de la izquierda de la pantalla a la derecha.
 *
 * El primer cuadrante va invertido porque la FDI numera desde la línea media
 * hacia atrás: para que el 11 y el 21 (o el 41 y el 31) queden juntos al
 * centro, el lado izquierdo tiene que dibujarse del 8 al 1.
 */
function piezasDeArcada(cuadrantes: number[]): string[] {
  const [primero, segundo] = cuadrantes as [number, number];
  return [...piezasDeCuadrante(primero).reverse(), ...piezasDeCuadrante(segundo)];
}

interface PosicionDiente {
  x: number;
  y: number;
  /** Grados a rotar para que la cara vestibular apunte hacia AFUERA del arco. */
  rotacion: number;
}

/**
 * Coloca TODA la arcada de una vez, repartiendo el arco en proporción al ancho
 * de cada corona.
 *
 * Se calcula en bloque y no pieza por pieza porque el reparto no puede ser
 * uniforme: un molar mide casi el doble que un incisivo lateral, así que con
 * ángulos iguales los molares se encimarían y los incisivos quedarían
 * separados. Cada diente ocupa el arco que le toca por tamaño.
 *
 * La rotación (90°−θ) es lo que vuelve el dibujo anatómicamente correcto: la
 * cara vestibular mira siempre hacia la mejilla y la palatina/lingual hacia
 * adentro, en cualquier punto del arco.
 */
function posicionesDeArcada(piezas: string[], superior: boolean): PosicionDiente[] {
  const { centroY, desde, hasta } = ARCADAS[superior ? 'superior' : 'inferior'];
  const anchos = piezas.map((p) => morfologiaDe(p).ancho + HOLGURA);
  const total = anchos.reduce((a, b) => a + b, 0);

  let acumulado = 0;
  return piezas.map((_, i) => {
    // Centro de la pieza dentro del recorrido total, en fracción de arco.
    const t = (acumulado + anchos[i]! / 2) / total;
    acumulado += anchos[i]!;

    const grados = desde + t * (hasta - desde);
    const rad = (grados * Math.PI) / 180;
    return {
      x: ANCHO / 2 + RX * Math.cos(rad),
      y: centroY - RY * Math.sin(rad),
      rotacion: 90 - grados,
    };
  });
}

function Arcada({
  piezas,
  superior,
  marcaDe,
  onTocar,
  piezaCompleta,
}: {
  piezas: string[];
  superior: boolean;
  marcaDe: (pieza: string, cara?: CaraDiente) => MarcaDental | undefined;
  onTocar: (pieza: string, cara?: CaraDiente) => void;
  piezaCompleta: boolean;
}) {
  const posiciones = posicionesDeArcada(piezas, superior);
  return (
    <>
      {piezas.map((pieza, i) => {
        const { x, y, rotacion } = posiciones[i]!;
        return (
          <div
            key={pieza}
            className="absolute"
            style={{ left: x, top: y, transform: 'translate(-50%, -50%)' }}
          >
            <Diente
              pieza={pieza}
              rotacion={rotacion}
              marcaDe={marcaDe}
              onTocar={onTocar}
              piezaCompleta={piezaCompleta}
            />
          </div>
        );
      })}
    </>
  );
}

function Diente({
  pieza,
  rotacion,
  marcaDe,
  onTocar,
  piezaCompleta,
}: {
  pieza: string;
  /** Giro en grados para alinear la pieza con su punto del arco. */
  rotacion: number;
  marcaDe: (pieza: string, cara?: CaraDiente) => MarcaDental | undefined;
  onTocar: (pieza: string, cara?: CaraDiente) => void;
  piezaCompleta: boolean;
}) {
  const marcaPieza = marcaDe(pieza);
  const colorPieza = marcaPieza ? estadoDentalPorKey(marcaPieza.estado)?.color : undefined;

  const colorCara = (cara: CaraDiente) => {
    const m = marcaDe(pieza, cara);
    return m ? estadoDentalPorKey(m.estado)?.color : undefined;
  };

  /** Al elegir un estado de pieza completa, cualquier zona marca el diente entero. */
  const tocar = (cara: CaraDiente) => onTocar(pieza, piezaCompleta ? undefined : cara);

  const { ancho, alto, tipo } = morfologiaDe(pieza);

  return (
    <div className="relative" style={{ width: ancho, height: alto }}>
      {/* El giro va en el diente, no en las caras: así el clip-path de cada
          cara se sigue escribiendo en coordenadas locales sencillas y la
          rotación se encarga de la anatomía.

          `overflow-hidden` es lo que hace que el contorno redondeado recorte
          también las caras de dentro; sin él, los trapecios se salen por las
          esquinas y el diente vuelve a verse cuadrado. */}
      <div
        className="relative h-full w-full overflow-hidden border border-slate-300 bg-white"
        style={{
          borderRadius: CONTORNO[tipo],
          transform: `rotate(${rotacion}deg)`,
          ...(colorPieza ? { backgroundColor: colorPieza, borderColor: colorPieza } : {}),
        }}
        title={`${pieza} · ${tipo}${marcaPieza ? ` · ${estadoDentalPorKey(marcaPieza.estado)?.label}` : ''}`}
      >
        {/* Las cuatro caras como trapecios alrededor de un centro cuadrado.
            clip-path evita tener que meter un SVG por diente.

            Cada botón cubre el diente COMPLETO (inset-0) y es el clip-path el
            que define su trapecio. Recortar dentro de una caja ya reducida
            (h-[30%], w-[30%]) dejaba astillas de un par de píxeles, imposibles
            de atinar. Como clip-path también recorta el área sensible al clic,
            los cuatro se superponen sin robarse los toques. */}
        {(
          [
            ['vestibular', 'polygon(0 0, 100% 0, 70% 30%, 30% 30%)'],
            ['palatino', 'polygon(0 100%, 30% 70%, 70% 70%, 100% 100%)'],
            ['mesial', 'polygon(0 0, 30% 30%, 30% 70%, 0 100%)'],
            ['distal', 'polygon(100% 0, 100% 100%, 70% 70%, 70% 30%)'],
          ] as const
        ).map(([cara, clip]) => (
          <button
            key={cara}
            type="button"
            aria-label={`${pieza} ${ETIQUETA_CARA[cara]}`}
            onClick={() => tocar(cara)}
            className="absolute inset-0 hover:bg-slate-900/10"
            style={{ clipPath: clip, backgroundColor: colorCara(cara) }}
          />
        ))}
        <button
          type="button"
          aria-label={`${pieza} ${ETIQUETA_CARA.oclusal}`}
          onClick={() => tocar('oclusal')}
          className="absolute left-[30%] top-[30%] h-[40%] w-[40%] hover:bg-slate-900/10"
          style={{ backgroundColor: colorCara('oclusal') }}
        />
      </div>

      {/* El número queda FUERA del diente girado y sin rotar: un "36" de
          cabeza en la arcada inferior sería ilegible justo donde más importa
          no equivocarse de pieza. Se empuja hacia afuera del arco. */}
      <span
        className="pointer-events-none absolute left-1/2 whitespace-nowrap text-[9px] font-medium text-slate-500"
        style={{
          top: '50%',
          transform: `translate(-50%, -50%) translateY(${etiquetaHaciaAfuera(rotacion, alto)}px)`,
        }}
      >
        {pieza}
      </span>
    </div>
  );
}

/**
 * Desplazamiento de la etiqueta para que caiga por fuera del arco.
 *
 * Con rotación 0 (incisivos superiores) el diente mira hacia arriba, así que
 * el número va arriba; en la arcada inferior la rotación ronda los 180° y el
 * número debe ir abajo. El signo del coseno da exactamente eso.
 */
function etiquetaHaciaAfuera(rotacion: number, alto: number): number {
  const rad = (rotacion * Math.PI) / 180;
  return -Math.cos(rad) * (alto / 2 + 8);
}

/** Lista textual de lo marcado: lo que se puede leer y dictar en voz alta. */
function ResumenMarcas({ marcas }: { marcas: MarcaDental[] }) {
  if (marcas.length === 0) {
    return <p className="mt-3 text-xs text-slate-400">Sin hallazgos registrados.</p>;
  }

  const porEstado = new Map<string, MarcaDental[]>();
  for (const m of marcas) {
    porEstado.set(m.estado, [...(porEstado.get(m.estado) ?? []), m]);
  }

  return (
    <ul className="mt-3 space-y-1">
      {[...porEstado].map(([estadoKey, ms]) => {
        const estado = estadoDentalPorKey(estadoKey);
        return (
          <li key={estadoKey} className="text-xs">
            <span
              className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle"
              style={{ backgroundColor: estado?.color }}
            />
            <strong>{estado?.label ?? estadoKey}:</strong>{' '}
            {ms
              .map((m) => (m.cara ? `${m.pieza} (${ETIQUETA_CARA[m.cara].toLowerCase()})` : m.pieza))
              .join(', ')}
          </li>
        );
      })}
    </ul>
  );
}
