'use client';

import { useId, useState } from 'react';
import {
  CATEGORIAS_HALLAZGO,
  ETIQUETA_CATEGORIA,
  ETIQUETA_LADO,
  ETIQUETA_VISTA,
  HALLAZGOS_PODOLOGICOS,
  VISTAS_PIE,
  ZONAS_PIE,
  hallazgoAplicaEnZona,
  hallazgoPodologicoPorKey,
  zonaPiePorKey,
  type CategoriaHallazgo,
  type LadoPie,
  type MarcaPodologica,
  type Podograma as PodogramaData,
  type VistaPie,
  type ZonaPie,
} from '@healthflow/shared-types';

/**
 * Podograma interactivo: el mapa de pies donde se marca la zona afectada.
 *
 * Sustituye la silueta que la podóloga imprime y raya a mano. Dos vistas
 * (planta y dorso) porque la mitad de los hallazgos de esta especialidad son
 * ungueales y las uñas no se ven por la planta.
 *
 * Los pies se muestran DERECHO a la izquierda de la pantalla e IZQUIERDO a la
 * derecha, que es el orden de la hoja de papel. No es un capricho de layout:
 * marcar el pie equivocado es el error clásico de estos mapas, y respetar el
 * orden que la médica ya tiene memorizado es la mejor defensa contra él.
 */
export function Podograma({
  valor,
  onChange,
  readOnly,
  modoImpresion,
}: {
  valor: PodogramaData;
  /**
   * Recibe un ACTUALIZADOR, no el valor ya calculado — misma razón que en el
   * odontograma: marcar varias zonas seguidas dispara varios onChange en el
   * mismo ciclo de React, y partir del `valor` de props (ya desactualizado)
   * haría que el último pisara a los anteriores. Perder un hallazgo por
   * marcar rápido no es aceptable en una nota clínica.
   */
  onChange: (actualizar: (previo: PodogramaData) => PodogramaData) => void;
  readOnly?: boolean;
  /**
   * Muestra planta Y dorso a la vez, sin selector ni herramientas de marcado.
   * En pantalla alternar de vista con un clic no cuesta nada; en papel no hay
   * forma de "voltear" la hoja, así que si solo se imprimiera la vista activa
   * las marcas de la otra —típicamente las ungueales, que son SOLO dorsales—
   * desaparecerían de la orden sin que nadie lo note.
   */
  modoImpresion?: boolean;
}) {
  const [vista, setVista] = useState<VistaPie>('plantar');
  const [categoria, setCategoria] = useState<CategoriaHallazgo>('cutaneo');
  const [hallazgoActivo, setHallazgoActivo] = useState<string>('hiperqueratosis');

  const marcasDe = (pie: LadoPie, zona: string) =>
    valor.marcas.filter((m) => m.pie === pie && m.zona === zona);

  /**
   * Alterna un hallazgo en una zona.
   *
   * A diferencia del odontograma —donde una cara tiene UN estado— aquí una
   * misma zona acumula varios hallazgos, porque clínicamente los tiene: un
   * hallux puede presentar onicomicosis y paroniquia a la vez, y obligar a
   * elegir uno perdería el otro. Volver a tocar con el mismo hallazgo lo
   * quita, que es el "deshacer" natural.
   */
  const alternar = (pie: LadoPie, zona: string) => {
    if (readOnly) return;
    // La regla vive en shared-types y la comparte la API: un hallazgo ungueal
    // no puede caer en el talón.
    if (!hallazgoAplicaEnZona(hallazgoActivo, zona)) return;

    onChange((previo) => {
      const yaEsta = previo.marcas.some(
        (m) => m.pie === pie && m.zona === zona && m.hallazgo === hallazgoActivo,
      );
      const marcas = previo.marcas.filter(
        (m) => !(m.pie === pie && m.zona === zona && m.hallazgo === hallazgoActivo),
      );
      if (!yaEsta) {
        marcas.push({ pie, zona, hallazgo: hallazgoActivo } satisfies MarcaPodologica);
      }
      return { ...previo, marcas };
    });
  };

  const hallazgo = hallazgoPodologicoPorKey(hallazgoActivo);
  const zonasDeVista = ZONAS_PIE.filter((z) => z.vista === vista);

  /**
   * Si el hallazgo activo es ungueal y estamos en la planta, no hay dónde
   * marcarlo. En vez de dejar que la médica toque zonas muertas sin entender
   * por qué no pasa nada, se avisa y se ofrece el cambio de vista.
   */
  const sinDondeMarcar = hallazgo?.soloUngueal === true && vista === 'plantar';

  if (modoImpresion) {
    return (
      <div>
        <div className="flex flex-wrap gap-6">
          {VISTAS_PIE.map((v) => (
            <div key={v}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {ETIQUETA_VISTA[v]}
              </p>
              <div className="flex w-fit gap-4">
                {(['derecho', 'izquierdo'] as const).map((pie) => (
                  <Pie
                    key={pie}
                    pie={pie}
                    vista={v}
                    zonas={ZONAS_PIE.filter((z) => z.vista === v)}
                    marcasDe={marcasDe}
                    onTocar={() => {}}
                    readOnly
                    hallazgoActivo={hallazgoActivo}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <ResumenPodograma marcas={valor.marcas} />
      </div>
    );
  }

  return (
    <div>
      {!readOnly && (
        <>
          {/* Familias de hallazgo. 37 botones sueltos serían inusables; el
              podólogo además busca por familia antes que por nombre. */}
          <div className="mb-2 flex flex-wrap gap-1.5">
            {CATEGORIAS_HALLAZGO.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategoria(c)}
                className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                  categoria === c
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {ETIQUETA_CATEGORIA[c]}
              </button>
            ))}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {HALLAZGOS_PODOLOGICOS.filter((h) => h.categoria === categoria).map((h) => (
              <button
                key={h.key}
                type="button"
                onClick={() => setHallazgoActivo(h.key)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                  hallazgoActivo === h.key
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white hover:border-slate-400'
                }`}
              >
                <span
                  className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle ring-1 ring-slate-300"
                  style={{ backgroundColor: h.color }}
                />
                {h.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Planta / Dorso */}
      <div className="mb-3 flex items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-300 p-0.5">
          {VISTAS_PIE.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVista(v)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                vista === v ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {ETIQUETA_VISTA[v]}
            </button>
          ))}
        </div>
        {!readOnly && !sinDondeMarcar && (
          <p className="text-xs text-slate-500">
            Toca la zona afectada. Volver a tocarla con el mismo hallazgo lo quita.
          </p>
        )}
      </div>

      {sinDondeMarcar && !readOnly && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <strong>{hallazgo?.label}</strong> es un hallazgo ungueal y las uñas se marcan por el
          dorso.{' '}
          <button
            type="button"
            onClick={() => setVista('dorsal')}
            className="font-medium underline underline-offset-2"
          >
            Cambiar a dorso
          </button>
        </p>
      )}

      {/* Scroll propio: los dos pies tienen un ancho mínimo y el resto de la
          página NO debe desplazarse en horizontal por su culpa. */}
      <div className="overflow-x-auto pb-2">
        <div className="mx-auto flex w-fit gap-6">
          {(['derecho', 'izquierdo'] as const).map((pie) => (
            <Pie
              key={pie}
              pie={pie}
              vista={vista}
              zonas={zonasDeVista}
              marcasDe={marcasDe}
              onTocar={alternar}
              readOnly={readOnly}
              hallazgoActivo={hallazgoActivo}
            />
          ))}
        </div>
      </div>

      <ResumenPodograma marcas={valor.marcas} />
    </div>
  );
}

// ── Geometría ────────────────────────────────────────────────────
//
// Todo el dibujo se define UNA vez, para un pie con el hallux a la IZQUIERDA
// del lienzo, y se refleja según toque. Escribir las dos siluetas a mano
// duplicaría 30 coordenadas y garantizaría que un día dejen de coincidir.

const ANCHO = 100;
const ALTO = 250;

/**
 * Silueta del cuerpo del pie, sin dedos (van como elipses aparte). La escotadura
 * del lado izquierdo es el arco medial: es lo que hace que se lea como un pie y
 * no como una pala.
 */
const CONTORNO_CUERPO =
  'M 13 60 C 8 78, 14 100, 26 120 C 34 136, 39 154, 39 170 ' +
  'C 38 193, 33 223, 52 232 C 71 234, 77 210, 76 186 ' +
  'C 75 160, 80 134, 84 110 C 88 88, 89 66, 82 54 ' +
  'C 62 45, 28 47, 13 60 Z';

/**
 * Dedos SOLO para la silueta, deliberadamente separados de las zonas
 * marcables: por la planta se marca el pulpejo y por el dorso la uña y el
 * dorso del dedo, en posiciones distintas. Si el contorno dependiera de las
 * zonas, cambiar un área sensible al clic deformaría el dibujo.
 */
const SILUETA_DEDOS = [
  { cx: 20, cy: 36, rx: 13, ry: 18 },
  { cx: 42, cy: 30, rx: 8.5, ry: 14 },
  { cx: 57, cy: 33, rx: 8, ry: 13 },
  { cx: 70, cy: 39, rx: 7.5, ry: 12 },
  { cx: 82, cy: 48, rx: 7, ry: 10.5 },
] as const;

function Pie({
  pie,
  vista,
  zonas,
  marcasDe,
  onTocar,
  readOnly,
  hallazgoActivo,
}: {
  pie: LadoPie;
  vista: VistaPie;
  zonas: readonly ZonaPie[];
  marcasDe: (pie: LadoPie, zona: string) => MarcaPodologica[];
  onTocar: (pie: LadoPie, zona: string) => void;
  readOnly?: boolean;
  hallazgoActivo: string;
}) {
  const clipId = useId();

  /**
   * La geometría base tiene el hallux a la izquierda, que es como se ve la
   * PLANTA del pie DERECHO. Los otros tres casos son su reflejo:
   *
   *   planta + derecho  → base      dorso + derecho  → reflejo
   *   planta + izquierdo→ reflejo   dorso + izquierdo→ base
   *
   * Es exactamente un XOR, y tenerlo en una línea con su tabla al lado evita
   * el bug clásico de estos mapas: dibujar dos pies derechos.
   */
  const espejo = (pie === 'izquierdo') !== (vista === 'dorsal');

  return (
    <figure className="m-0">
      <figcaption className="mb-1 text-center text-xs font-medium uppercase tracking-wide text-slate-500">
        {ETIQUETA_LADO[pie]}
      </figcaption>

      <svg
        viewBox={`0 0 ${ANCHO} ${ALTO}`}
        className="h-[330px] w-[132px] select-none"
        role="group"
        aria-label={`Pie ${ETIQUETA_LADO[pie].toLowerCase()}, vista ${ETIQUETA_VISTA[vista].toLowerCase()}`}
      >
        {/* El reflejo se aplica al grupo entero: geometría escrita una vez. */}
        <g transform={espejo ? `translate(${ANCHO},0) scale(-1,1)` : undefined}>
          {/* La silueta también es el recorte: así una zona que se pase unos
              píxeles del borde (el arco, el talón) se corta contra el contorno
              en vez de salirse y romper la forma del pie. */}
          <clipPath id={clipId}>
            <path d={CONTORNO_CUERPO} />
            {SILUETA_DEDOS.map((d, i) => (
              <ellipse key={i} cx={d.cx} cy={d.cy} rx={d.rx} ry={d.ry} />
            ))}
          </clipPath>

          <g fill="#f8fafc" stroke="#94a3b8" strokeWidth={1.2}>
            <path d={CONTORNO_CUERPO} />
            {SILUETA_DEDOS.map((d, i) => (
              <ellipse key={i} cx={d.cx} cy={d.cy} rx={d.rx} ry={d.ry} />
            ))}
          </g>

          <g clipPath={`url(#${clipId})`}>
            {zonas.map((zona) => (
              <ZonaMarcable
                key={zona.key}
                zona={zona}
                pie={pie}
                marcas={marcasDe(pie, zona.key)}
                onTocar={onTocar}
                readOnly={readOnly}
                permitida={hallazgoAplicaEnZona(hallazgoActivo, zona.key)}
              />
            ))}
          </g>
        </g>
      </svg>
    </figure>
  );
}

function ZonaMarcable({
  zona,
  pie,
  marcas,
  onTocar,
  readOnly,
  permitida,
}: {
  zona: ZonaPie;
  pie: LadoPie;
  marcas: MarcaPodologica[];
  onTocar: (pie: LadoPie, zona: string) => void;
  readOnly?: boolean;
  /** El hallazgo activo puede registrarse aquí. */
  permitida: boolean;
}) {
  const primera = marcas[0];
  const color = primera ? hallazgoPodologicoPorKey(primera.hallazgo)?.color : undefined;

  const detalle = marcas
    .map((m) => hallazgoPodologicoPorKey(m.hallazgo)?.label ?? m.hallazgo)
    .join(', ');

  const interactiva = !readOnly && permitida;

  return (
    <g
      onClick={interactiva ? () => onTocar(pie, zona.key) : undefined}
      className={interactiva ? 'cursor-pointer' : undefined}
    >
      <title>{detalle ? `${zona.label} · ${detalle}` : zona.label}</title>
      <ellipse
        cx={zona.cx}
        cy={zona.cy}
        rx={zona.rx}
        ry={zona.ry}
        fill={color ?? 'transparent'}
        fillOpacity={color ? 0.75 : 1}
        // Punteado tenue en las zonas vacías: sin él no hay forma de saber
        // dónde se puede tocar, y la médica acabaría picando al azar.
        stroke={color ?? (interactiva ? '#cbd5e1' : '#e2e8f0')}
        strokeWidth={color ? 1 : 0.7}
        strokeDasharray={color ? undefined : '2 2'}
        className={interactiva ? 'transition-[fill-opacity] hover:fill-slate-400' : undefined}
      />
      {/* Más de un hallazgo en la misma zona: el relleno solo alcanza para
          uno, así que el resto se anuncia con el contador. Sin esto, marcar
          el segundo hallazgo no produciría ningún cambio visible. */}
      {marcas.length > 1 && (
        <text
          x={zona.cx}
          y={zona.cy + 3}
          textAnchor="middle"
          fontSize={9}
          fontWeight={700}
          fill="#fff"
          stroke="#0f172a"
          strokeWidth={0.4}
          className="pointer-events-none"
        >
          {marcas.length}
        </text>
      )}
    </g>
  );
}

/**
 * Lista de lo marcado. No es decoración: es la versión que se puede leer en voz
 * alta, dictar y —sobre todo— imprimir. El expediente en papel no lleva el SVG.
 */
function ResumenPodograma({ marcas }: { marcas: MarcaPodologica[] }) {
  if (marcas.length === 0) {
    return <p className="mt-3 text-xs text-slate-400">Sin hallazgos registrados.</p>;
  }

  const porHallazgo = new Map<string, MarcaPodologica[]>();
  for (const m of marcas) {
    porHallazgo.set(m.hallazgo, [...(porHallazgo.get(m.hallazgo) ?? []), m]);
  }

  return (
    <ul className="mt-3 space-y-1">
      {[...porHallazgo].map(([key, ms]) => {
        const h = hallazgoPodologicoPorKey(key);
        return (
          <li key={key} className="text-xs">
            <span
              className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle ring-1 ring-slate-300"
              style={{ backgroundColor: h?.color }}
            />
            <strong>{h?.label ?? key}:</strong>{' '}
            {ms
              .map(
                (m) =>
                  `${zonaPiePorKey(m.zona)?.label ?? m.zona} (${ETIQUETA_LADO[m.pie].toLowerCase()})`,
              )
              .join(', ')}
          </li>
        );
      })}
    </ul>
  );
}
