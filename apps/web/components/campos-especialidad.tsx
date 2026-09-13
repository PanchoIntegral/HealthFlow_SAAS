'use client';

import type {
  CampoExtra,
  DatoNoCapturado,
  ErrorCierre,
  EsquemaNota,
} from '@healthflow/shared-types';
import { RichTextEditor } from './rich-text-editor';
import { ControlNoCapturado } from './nota/control-no-capturado';
import { campoDe, erroresDe } from './nota/esquema-ui';

type Valor = string | number | null;

/**
 * Renderiza los campos propios de la especialidad del médico. No sabe nada de
 * odontología ni de pediatría: recibe la definición desde el catálogo
 * (PERFILES en shared-types) y la pinta. Agregar una especialidad nunca
 * requiere tocar este archivo.
 */
export function CamposEspecialidad({
  campos,
  esquema,
  pendientes,
  valores,
  onChange,
  noCapturado,
  onNoCapturado,
  readOnly,
  faltantes,
}: {
  /** Presentación de cada campo (catálogo); cuáles se muestran lo decide `esquema`. */
  campos: readonly CampoExtra[];
  /** Esquema calculado por la API: requisito y estados de no captura de cada campo. */
  esquema: EsquemaNota | undefined;
  pendientes: ErrorCierre[];
  valores: Record<string, Valor>;
  onChange: (key: string, valor: Valor) => void;
  noCapturado: Record<string, DatoNoCapturado>;
  onNoCapturado: (ruta: string, valor: DatoNoCapturado | undefined) => void;
  readOnly?: boolean;
  /** Claves ya prefijadas con `extension.`, como las devuelve la API. */
  faltantes: string[];
}) {
  if (campos.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {campos.map((campo) => {
        const ruta = `extension.${campo.key}`;
        const falta = faltantes.includes(ruta);
        const enEsquema = campoDe(esquema, ruta);
        // Los campos largos ocupan el ancho completo; los cortos van en dos
        // columnas para que la nota no se convierta en un formulario infinito.
        // El checklist también, por lo mismo que el texto rico: una rejilla de
        // 20 casillas apretada a media columna se vuelve ilegible.
        const anchoCompleto = campo.tipo === 'texto-rico' || campo.tipo === 'multi-seleccion';

        return (
          <div key={campo.key} className={anchoCompleto ? 'sm:col-span-2' : undefined}>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              {campo.label}
              {campo.unidad && <span className="text-slate-400"> ({campo.unidad})</span>}
              {enEsquema?.requisito === 'requerido' && <span className="text-red-500"> *</span>}
            </label>

            <CampoControl
              campo={campo}
              valor={valores[campo.key] ?? null}
              onChange={(v) => onChange(campo.key, v)}
              readOnly={readOnly}
              falta={falta}
            />

            {campo.ayuda && <p className="mt-1 text-xs text-slate-400">{campo.ayuda}</p>}
            {/* Por qué la regla activa lo pide en ESTA consulta. */}
            {enEsquema?.ayuda && enEsquema.requisito === 'requerido' && (
              <p className="mt-1 text-xs text-amber-700">{enEsquema.ayuda}</p>
            )}

            {enEsquema && (
              <ControlNoCapturado
                campo={enEsquema}
                valor={noCapturado[ruta]}
                onChange={(v) => onNoCapturado(ruta, v)}
                readOnly={readOnly}
                errores={erroresDe(pendientes, ruta)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CampoControl({
  campo,
  valor,
  onChange,
  readOnly,
  falta,
}: {
  campo: CampoExtra;
  valor: Valor;
  onChange: (v: Valor) => void;
  readOnly?: boolean;
  falta: boolean;
}) {
  const borde = falta ? 'border-red-300' : 'border-slate-300';
  const base = `w-full rounded-lg border px-3 py-2 outline-none focus:border-brand-blue disabled:bg-slate-50 ${borde}`;

  if (campo.tipo === 'texto-rico') {
    return (
      <div className={falta ? 'rounded-lg ring-1 ring-red-300' : undefined}>
        <RichTextEditor
          value={typeof valor === 'string' ? valor : ''}
          onChange={(html) => onChange(html)}
          editable={!readOnly}
          placeholder={campo.ayuda ?? ''}
        />
      </div>
    );
  }

  if (campo.tipo === 'seleccion') {
    return (
      <select
        value={typeof valor === 'string' ? valor : ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={readOnly}
        className={base}
      >
        <option value="">Sin especificar</option>
        {(campo.opciones ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  if (campo.tipo === 'multi-seleccion') {
    // El valor vive como string —las opciones marcadas, unidas por coma— para
    // no cambiar la forma de `extension` (que es Record<string, string |
    // number | null>) solo por este tipo de campo. Se parte y se reconstruye
    // aquí, en el único lugar que necesita saber que es una lista.
    const marcadas = typeof valor === 'string' && valor.length > 0 ? valor.split(',') : [];

    const alternar = (opcion: string) => {
      const siguiente = marcadas.includes(opcion)
        ? marcadas.filter((o) => o !== opcion)
        : [...marcadas, opcion];
      onChange(siguiente.length > 0 ? siguiente.join(',') : null);
    };

    return (
      <div
        className={`grid gap-x-4 gap-y-1.5 rounded-lg border px-3 py-2 sm:grid-cols-3 ${falta ? 'border-red-300' : 'border-slate-200'}`}
      >
        {(campo.opciones ?? []).map((o) => (
          <label key={o} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={marcadas.includes(o)}
              disabled={readOnly}
              onChange={() => alternar(o)}
              className="shrink-0"
            />
            {o}
          </label>
        ))}
      </div>
    );
  }

  if (campo.tipo === 'numero') {
    return (
      <input
        type="number"
        // Ojo: `?? ''` y no `|| ''`. El cero es un valor clínico válido (un
        // CPOD de 0 cariados es un hallazgo), y `||` lo borraría de la pantalla.
        value={valor ?? ''}
        min={campo.min}
        max={campo.max}
        step={campo.step}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        disabled={readOnly}
        className={base}
      />
    );
  }

  return (
    <input
      value={typeof valor === 'string' ? valor : ''}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={readOnly}
      className={base}
    />
  );
}
