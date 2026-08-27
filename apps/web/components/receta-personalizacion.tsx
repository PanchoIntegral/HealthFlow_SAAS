'use client';

import { useRef, useState } from 'react';
import {
  CONFIG_RECETA_DEFAULT,
  ETIQUETAS_RECETA_DEFAULT,
  TAMANOS_LOGO,
  normalizarOrdenSecciones,
  type ConfigReceta,
  type RecetaDetalle,
  type SeccionReceta,
  type TituloMedico,
} from '@healthflow/shared-types';
import { HojaReceta } from './hoja-receta';

/** Qué contiene cada bloque, para que el médico sepa qué está moviendo. */
const DESCRIPCION_SECCION: Record<SeccionReceta, string> = {
  diagnostico: 'Los diagnósticos con su clave CIE-10',
  indicaciones: 'El texto libre de indicaciones al paciente',
  prescripcion: 'Los medicamentos con dosis, vía y duración',
};

const ETIQUETA_TAMANO: Record<ConfigReceta['logoTamano'], string> = {
  chico: 'Chico',
  mediano: 'Mediano',
  grande: 'Grande',
};

/** Paleta acotada: colores que sobreviven a una impresora láser y a un fax de farmacia. */
const COLORES = [
  { valor: null, nombre: 'Gris (por omisión)', muestra: '#94a3b8' },
  { valor: '#1d4ed8', nombre: 'Azul', muestra: '#1d4ed8' },
  { valor: '#0f766e', nombre: 'Verde', muestra: '#0f766e' },
  { valor: '#9d174d', nombre: 'Vino', muestra: '#9d174d' },
  { valor: '#3f3f46', nombre: 'Grafito', muestra: '#3f3f46' },
];

export interface DatosPrevia {
  nombreClinica: string;
  direccion: string | null;
  telefono: string | null;
  leyendaPie: string;
  logoUrl: string | null;
  medicoNombre: string;
  titulo: TituloMedico | null;
  cedulaProfesional: string;
  cedulaEspecialidad: string | null;
  especialidad: string | null;
  institucionTitulo: string;
}

/**
 * Receta de mentiras para la vista previa. Los datos del membrete son los
 * REALES (es lo que el médico está configurando); el paciente y el
 * medicamento son inventados y se ven inventados a propósito — nadie debe
 * confundir esta hoja con una receta emitida.
 */
export function recetaDeEjemplo(d: DatosPrevia, config: ConfigReceta): RecetaDetalle {
  return {
    id: 'previa',
    patientId: 'previa',
    appointmentId: null,
    doctorId: 'previa',
    folio: 'RX-0000-000000',
    cancelacion: null,
    createdAt: new Date().toISOString(),
    patientNombre: 'Paciente de Ejemplo',
    contenido: {
      emisor: {
        medicoNombre: d.medicoNombre,
        titulo: d.titulo,
        config,
        cedulaProfesional: d.cedulaProfesional || '0000000',
        cedulaEspecialidad: d.cedulaEspecialidad,
        especialidad: d.especialidad,
        institucionTitulo: d.institucionTitulo || 'Institución que expidió tu título',
        nombreClinica: d.nombreClinica || 'Nombre de tu clínica',
        domicilioEstablecimiento: d.direccion ?? 'Domicilio del consultorio',
        telefonoClinica: d.telefono,
        logoStorageKey: null,
        logoUrl: d.logoUrl ?? undefined,
        leyendaPie: d.leyendaPie || null,
      },
      paciente: { nombre: 'Paciente de Ejemplo', edad: 42, sexo: 'femenino' },
      diagnosticos: [{ cie10: 'J00', descripcion: 'Rinofaringitis aguda' }],
      medicamentos: [
        {
          clave: null,
          denominacionGenerica: 'Paracetamol',
          denominacionDistintiva: null,
          presentacion: 'Tabletas 500 mg',
          dosis: '1 tableta',
          via: 'Oral',
          frecuencia: 'cada 8 horas',
          duracion: '3 días',
          indicaciones: 'Tomar después de los alimentos.',
          fraccion: null,
        },
      ],
      indicacionesGenerales: 'Reposo relativo e hidratación abundante.',
      alergiasSnapshot: [],
    },
  };
}

/** Controles de apariencia. El estado vive arriba para que la previa reaccione al instante. */
export function ControlesApariencia({
  config,
  onChange,
  disabled,
}: {
  config: ConfigReceta;
  /**
   * Recibe un ACTUALIZADOR, no el valor ya calculado — misma razón que en el
   * podograma y el odontograma: dos controles tocados en el mismo ciclo de
   * React parten del mismo `config` de props, y el segundo cambio borraría el
   * primero. Con la función, cada uno parte del estado real.
   */
  onChange: (actualizar: (previo: ConfigReceta) => ConfigReceta) => void;
  disabled?: boolean;
}) {
  const set = <K extends keyof ConfigReceta>(k: K, v: ConfigReceta[K]) =>
    onChange((previo) => ({ ...previo, [k]: v }));

  return (
    <div className="space-y-4">
      <div>
        <span className="mb-1.5 block text-sm font-medium text-slate-600">Tamaño del logo</span>
        <div className="flex gap-2">
          {TAMANOS_LOGO.map((t) => (
            <button
              key={t}
              type="button"
              disabled={disabled || config.papelMembretado}
              onClick={() => set('logoTamano', t)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition disabled:opacity-40 ${
                config.logoTamano === t
                  ? 'border-brand-blue bg-brand-blue/10 font-medium text-brand-blue'
                  : 'border-slate-300 text-slate-600 hover:border-brand-blue'
              }`}
            >
              {ETIQUETA_TAMANO[t]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="mb-1.5 block text-sm font-medium text-slate-600">Color de acento</span>
        <div className="flex flex-wrap gap-2">
          {COLORES.map((c) => (
            <button
              key={c.nombre}
              type="button"
              disabled={disabled}
              onClick={() => set('colorAcento', c.valor)}
              title={c.nombre}
              aria-label={c.nombre}
              className={`h-8 w-8 rounded-full border-2 transition disabled:opacity-40 ${
                config.colorAcento === c.valor
                  ? 'border-slate-800 ring-2 ring-slate-300'
                  : 'border-transparent hover:border-slate-300'
              }`}
              style={{ backgroundColor: c.muestra }}
            />
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Solo tiñe la línea del membrete y los títulos. El contenido de la receta se imprime
          siempre en negro: muchas farmacias la reciben fotocopiada o por fax.
        </p>
      </div>

      <OrdenSecciones config={config} onChange={onChange} disabled={disabled} />

      <div>
        <span className="mb-1.5 block text-sm font-medium text-slate-600">
          Dirección y teléfono del consultorio
        </span>
        <div className="flex gap-2">
          {(['encabezado', 'pie'] as const).map((pos) => (
            <button
              key={pos}
              type="button"
              disabled={disabled}
              onClick={() => set('posicionDomicilio', pos)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition disabled:opacity-40 ${
                config.posicionDomicilio === pos
                  ? 'border-brand-blue bg-brand-blue/10 font-medium text-brand-blue'
                  : 'border-slate-300 text-slate-600 hover:border-brand-blue'
              }`}
            >
              {pos === 'encabezado' ? 'Arriba, en el membrete' : 'Abajo, junto al horario'}
            </button>
          ))}
        </div>
      </div>

      <Interruptor
        label="Mostrar mi especialidad"
        activo={config.mostrarEspecialidad}
        onChange={(v) => set('mostrarEspecialidad', v)}
        disabled={disabled}
      />
      <Interruptor
        label="Mostrar la leyenda del pie"
        activo={config.mostrarLeyendaPie}
        onChange={(v) => set('mostrarLeyendaPie', v)}
        disabled={disabled}
      />
      <Interruptor
        label="Ya imprimo en papel con membrete"
        ayuda="Deja libre la parte superior de la hoja y omite el logo, el nombre y el domicilio de la clínica, que tu papel ya trae. Asegúrate de que ese papel incluya el nombre y el domicilio del consultorio: el artículo 64 del RIS los exige en toda receta."
        activo={config.papelMembretado}
        onChange={(v) => set('papelMembretado', v)}
        disabled={disabled}
      />
    </div>
  );
}

/**
 * Orden del cuerpo de la receta, arrastrable.
 *
 * Con Pointer Events y no con el drag-and-drop nativo de HTML: aquél no existe
 * en pantallas táctiles, y buena parte de los consultorios configura esto desde
 * una tablet. Los mismos handlers sirven para mouse y para dedo.
 *
 * Las flechas se quedan ADEMÁS del arrastre: son el camino accesible por
 * teclado y el que funciona sin motricidad fina.
 */
function OrdenSecciones({
  config,
  onChange,
  disabled,
}: {
  config: ConfigReceta;
  onChange: (actualizar: (previo: ConfigReceta) => ConfigReceta) => void;
  disabled?: boolean;
}) {
  const orden = normalizarOrdenSecciones(config.ordenSecciones);
  const listaRef = useRef<HTMLUListElement>(null);
  /**
   * El índice vive en un ref y no solo en el estado: un arrastre rápido
   * dispara pointerdown y pointermove en el mismo tick, y el handler leería
   * el `useState` del render anterior —todavía en null— y descartaría el
   * movimiento. El estado se conserva únicamente para resaltar la fila.
   */
  const arrastrandoRef = useRef<number | null>(null);
  const [arrastrando, setArrastrando] = useState<number | null>(null);

  const marcar = (i: number | null) => {
    arrastrandoRef.current = i;
    setArrastrando(i);
  };

  const mover = (desde: number, hasta: number) => {
    if (hasta < 0 || hasta >= orden.length || desde === hasta) return;
    const nuevo = [...orden];
    const [movido] = nuevo.splice(desde, 1);
    nuevo.splice(hasta, 0, movido!);
    onChange((previo) => ({ ...previo, ordenSecciones: nuevo }));
  };

  /** Índice de la fila que está bajo el puntero, o -1. */
  const indiceBajo = (clientY: number) => {
    const items = Array.from(listaRef.current?.children ?? []) as HTMLElement[];
    return items.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return clientY >= r.top && clientY <= r.bottom;
    });
  };

  const alMover = (e: React.PointerEvent) => {
    const desde = arrastrandoRef.current;
    if (desde === null) return;
    const destino = indiceBajo(e.clientY);
    if (destino !== -1 && destino !== desde) {
      mover(desde, destino);
      // La fila arrastrada ya vive en la posición nueva: sin esto el siguiente
      // movimiento partiría del índice viejo y la lista daría saltos.
      marcar(destino);
    }
  };

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-slate-600">Orden de la receta</span>
      <ul
        ref={listaRef}
        className="space-y-1.5"
        onPointerMove={alMover}
        // Soltar fuera de una fila (o al salir de la lista) no debe dejar el
        // arrastre pegado al puntero.
        onPointerUp={() => marcar(null)}
        onPointerLeave={() => marcar(null)}
      >
        {orden.map((seccion, i) => (
          <li
            key={seccion}
            className={`flex items-center gap-2 rounded-lg border bg-white px-3 py-2 transition ${
              arrastrando === i
                ? 'border-brand-blue shadow-sm ring-2 ring-brand-blue/20'
                : 'border-slate-200'
            } ${disabled ? 'opacity-50' : ''}`}
          >
            <span
              aria-hidden
              // touch-none: en el móvil, sin esto el gesto se lo lleva el scroll
              // de la página y la fila nunca llega a moverse.
              className={`touch-none select-none text-lg leading-none text-slate-300 ${
                disabled ? '' : 'cursor-grab active:cursor-grabbing'
              }`}
              onPointerDown={(e) => {
                if (disabled) return;
                e.preventDefault();
                marcar(i);
              }}
              onPointerUp={() => marcar(null)}
            >
              ⠿
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-slate-700">
                {config.etiquetas?.[seccion]?.trim() || ETIQUETAS_RECETA_DEFAULT[seccion]}
              </span>
              <span className="block text-xs text-slate-400">{DESCRIPCION_SECCION[seccion]}</span>
            </span>
            <span className="flex shrink-0 flex-col">
              <button
                type="button"
                disabled={disabled || i === 0}
                onClick={() => mover(i, i - 1)}
                aria-label={`Subir ${ETIQUETAS_RECETA_DEFAULT[seccion]}`}
                className="px-1 text-xs text-slate-400 hover:text-brand-blue disabled:opacity-25"
              >
                ▲
              </button>
              <button
                type="button"
                disabled={disabled || i === orden.length - 1}
                onClick={() => mover(i, i + 1)}
                aria-label={`Bajar ${ETIQUETAS_RECETA_DEFAULT[seccion]}`}
                className="px-1 text-xs text-slate-400 hover:text-brand-blue disabled:opacity-25"
              >
                ▼
              </button>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-slate-400">
        Arrastra los bloques por el asa ⠿ o usa las flechas. El membrete, la ficha del paciente y
        la firma conservan su lugar.
      </p>
    </div>
  );
}

/** Encabezados de cada bloque: cada consultorio los nombra a su manera. */
export function EtiquetasSecciones({
  config,
  onChange,
  disabled,
}: {
  config: ConfigReceta;
  onChange: (actualizar: (previo: ConfigReceta) => ConfigReceta) => void;
  disabled?: boolean;
}) {
  const set = (clave: keyof ConfigReceta['etiquetas'], valor: string) =>
    onChange((previo) => ({
      ...previo,
      etiquetas: { ...ETIQUETAS_RECETA_DEFAULT, ...previo.etiquetas, [clave]: valor },
    }));

  const campos: { clave: keyof ConfigReceta['etiquetas']; label: string }[] = [
    { clave: 'diagnostico', label: 'Título del diagnóstico' },
    { clave: 'indicaciones', label: 'Título de las indicaciones' },
    { clave: 'prescripcion', label: 'Título de los medicamentos' },
    { clave: 'firma', label: 'Texto bajo la línea de firma' },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {campos.map(({ clave, label }) => (
        <label key={clave} className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">{label}</span>
          <input
            value={config.etiquetas?.[clave] ?? ''}
            onChange={(e) => set(clave, e.target.value)}
            disabled={disabled}
            maxLength={60}
            placeholder={ETIQUETAS_RECETA_DEFAULT[clave]}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue disabled:bg-slate-50"
          />
        </label>
      ))}
    </div>
  );
}

function Interruptor({
  label,
  ayuda,
  activo,
  onChange,
  disabled,
}: {
  label: string;
  ayuda?: string;
  activo: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input
        type="checkbox"
        checked={activo}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-blue focus:ring-brand-blue"
      />
      <span>
        <span className="font-medium text-slate-600">{label}</span>
        {ayuda && <span className="mt-0.5 block text-xs text-slate-400">{ayuda}</span>}
      </span>
    </label>
  );
}

/**
 * Vista previa de la hoja.
 *
 * Ancho de hoja real y no una columna estrecha: comprimida, el membrete parte
 * el nombre del médico en dos renglones y el color se ve donde no va — el
 * médico terminaba juzgando su receta por una miniatura deformada. Aquí la
 * hoja se dibuja a su proporción (una carta) y, si el panel es angosto, se
 * desplaza en horizontal dentro de su propia caja en vez de encogerse.
 */
export function PreviaReceta({ receta }: { receta: RecetaDetalle }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-100 p-4">
      <p className="mb-3 text-center text-xs font-medium uppercase tracking-wide text-slate-400">
        Vista previa · así se imprime
      </p>
      <div className="overflow-x-auto">
        {/* 794px = ancho de una carta a 96 dpi. La sombra y el borde la hacen
            leerse como una hoja y no como otra tarjeta de la interfaz. */}
        <div className="mx-auto w-[794px] max-w-full rounded-lg border border-slate-300 bg-white shadow-md">
          <HojaReceta receta={receta} />
        </div>
      </div>
    </div>
  );
}

export { CONFIG_RECETA_DEFAULT };
