'use client';

import type { CampoExtra } from '@healthflow/shared-types';
import { RichTextEditor } from './rich-text-editor';

type Valor = string | number | null;

/**
 * Renderiza los campos propios de la especialidad del médico. No sabe nada de
 * odontología ni de pediatría: recibe la definición desde el catálogo
 * (PERFILES en shared-types) y la pinta. Agregar una especialidad nunca
 * requiere tocar este archivo.
 */
export function CamposEspecialidad({
  campos,
  valores,
  onChange,
  readOnly,
  faltantes,
}: {
  campos: readonly CampoExtra[];
  valores: Record<string, Valor>;
  onChange: (key: string, valor: Valor) => void;
  readOnly?: boolean;
  /** Claves ya prefijadas con `extension.`, como las devuelve la API. */
  faltantes: string[];
}) {
  if (campos.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {campos.map((campo) => {
        const falta = faltantes.includes(`extension.${campo.key}`);
        // Los campos largos ocupan el ancho completo; los cortos van en dos
        // columnas para que la nota no se convierta en un formulario infinito.
        const anchoCompleto = campo.tipo === 'texto-rico';

        return (
          <div key={campo.key} className={anchoCompleto ? 'sm:col-span-2' : undefined}>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              {campo.label}
              {campo.unidad && <span className="text-slate-400"> ({campo.unidad})</span>}
              {campo.obligatorio && <span className="text-red-500"> *</span>}
            </label>

            <CampoControl
              campo={campo}
              valor={valores[campo.key] ?? null}
              onChange={(v) => onChange(campo.key, v)}
              readOnly={readOnly}
              falta={falta}
            />

            {campo.ayuda && <p className="mt-1 text-xs text-slate-400">{campo.ayuda}</p>}
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

  if (campo.tipo === 'numero') {
    return (
      <input
        type="number"
        // Ojo: `?? ''` y no `|| ''`. El cero es un valor clínico válido (un
        // CPOD de 0 cariados es un hallazgo), y `||` lo borraría de la pantalla.
        value={valor ?? ''}
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
