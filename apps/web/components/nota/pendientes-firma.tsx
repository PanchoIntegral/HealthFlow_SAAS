'use client';

import type { ErrorCierre, EsquemaNota, PerfilEspecialidad } from '@healthflow/shared-types';
import { etiquetaDeRuta, mensajeDeError } from './esquema-ui';

/**
 * Qué falta para firmar, tal como lo calculó la API en el último guardado.
 * El progreso cuenta requisitos del esquema; nada aquí evalúa reglas.
 */
export function PendientesFirma({
  esquema,
  pendientes,
  perfil,
  guardando,
}: {
  esquema: EsquemaNota | undefined;
  pendientes: ErrorCierre[];
  perfil: PerfilEspecialidad;
  guardando: boolean;
}) {
  const requeridos = esquema?.campos.filter((c) => c.requisito === 'requerido').length ?? 0;
  const rutasPendientes = new Set(pendientes.map((p) => p.ruta.split('.').slice(0, 2).join('.')));
  const pendientesRequeridos = esquema?.campos.filter(
    (c) => c.requisito === 'requerido' && rutasPendientes.has(c.ruta),
  ).length ?? 0;
  const hechos = Math.max(0, requeridos - pendientesRequeridos);
  const pct = requeridos === 0 ? 100 : Math.round((hechos / requeridos) * 100);

  return (
    <div data-testid="pendientes-firma">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-semibold">
          {hechos} de {requeridos} requisitos
        </span>
        <span className="text-slate-400">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full bg-gradient-to-r from-brand-blue to-brand-green" style={{ width: `${pct}%` }} />
      </div>

      {pendientes.length > 0 ? (
        <>
          <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Pendientes para firmar {guardando && <span className="font-normal normal-case">· actualizando…</span>}
          </p>
          <ul className="space-y-1">
            {pendientes.map((p) => (
              <li key={`${p.ruta}-${p.codigo}`} className="text-xs" data-codigo={p.codigo} data-ruta={p.ruta}>
                <span className="font-medium text-slate-700">{etiquetaDeRuta(p.ruta, perfil)}</span>
                <span className="text-slate-500"> — {mensajeDeError(p)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-3 text-xs text-emerald-700">Sin pendientes: la nota puede firmarse.</p>
      )}
    </div>
  );
}
