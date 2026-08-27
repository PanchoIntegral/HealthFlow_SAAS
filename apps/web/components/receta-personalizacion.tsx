'use client';

import {
  CONFIG_RECETA_DEFAULT,
  TAMANOS_LOGO,
  type ConfigReceta,
  type RecetaDetalle,
  type TituloMedico,
} from '@healthflow/shared-types';
import { HojaReceta } from './hoja-receta';

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
 * Se renderiza a su ancho natural dentro de la columna, sin `transform:
 * scale`: escalarla obliga a compensar a mano el hueco que deja el reescalado,
 * y cualquier desajuste recorta la hoja por un lado — justo lo que no puede
 * pasar en el elemento cuyo trabajo es mostrar fielmente lo que se imprime.
 */
export function PreviaReceta({ receta }: { receta: RecetaDetalle }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-100 p-3">
      <p className="mb-2 text-center text-xs font-medium uppercase tracking-wide text-slate-400">
        Vista previa
      </p>
      <div className="overflow-hidden rounded-lg bg-white shadow-sm">
        <HojaReceta receta={receta} />
      </div>
    </div>
  );
}

export { CONFIG_RECETA_DEFAULT };
