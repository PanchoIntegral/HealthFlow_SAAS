'use client';

import type { CampoEsquema, DatoNoCapturado, ErrorCierre } from '@healthflow/shared-types';
import { ETIQUETA_ESTADO_NO_CAPTURADO } from './esquema-ui';

/**
 * Declarar que un dato NO se capturó, con su porqué. Sólo aparece si la API
 * permite algún estado para ese campo, y ofrece exactamente esos estados: el
 * editor no decide cuáles valen ni si el motivo es obligatorio.
 *
 * Una declaración no borra lo capturado; si hay dato, el dato manda.
 */
export function ControlNoCapturado({
  campo,
  valor,
  onChange,
  readOnly,
  errores,
}: {
  campo: CampoEsquema;
  valor: DatoNoCapturado | undefined;
  onChange: (v: DatoNoCapturado | undefined) => void;
  readOnly?: boolean;
  errores: ErrorCierre[];
}) {
  if (campo.estadosPermitidos.length === 0) return null;
  const faltaMotivo = errores.some((e) => e.codigo === 'MOTIVO_REQUERIDO');
  const id = `nc-${campo.ruta}`;

  return (
    <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs" data-testid={id}>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={!!valor}
          disabled={readOnly}
          onChange={(e) =>
            onChange(e.target.checked ? { estado: campo.estadosPermitidos[0]! } : undefined)
          }
        />
        <span className="font-medium text-slate-600">No se capturó este dato</span>
      </label>
      {valor && (
        <div className="mt-2 grid gap-2 sm:grid-cols-[180px_1fr]">
          <select
            aria-label="Estado"
            value={valor.estado}
            disabled={readOnly}
            onChange={(e) => onChange({ ...valor, estado: e.target.value as DatoNoCapturado['estado'] })}
            className="rounded-lg border border-slate-300 px-2 py-1.5 outline-none focus:border-brand-blue disabled:bg-white"
          >
            {campo.estadosPermitidos.map((estado) => (
              <option key={estado} value={estado}>
                {ETIQUETA_ESTADO_NO_CAPTURADO[estado]}
              </option>
            ))}
          </select>
          <input
            aria-label="Motivo"
            value={valor.motivo ?? ''}
            disabled={readOnly}
            maxLength={500}
            onChange={(e) => onChange({ ...valor, motivo: e.target.value || undefined })}
            placeholder={campo.requiereMotivo ? 'Motivo (obligatorio)' : 'Motivo (opcional)'}
            className={`rounded-lg border px-2 py-1.5 outline-none focus:border-brand-blue disabled:bg-white ${
              faltaMotivo ? 'border-red-300' : 'border-slate-300'
            }`}
          />
        </div>
      )}
    </div>
  );
}
