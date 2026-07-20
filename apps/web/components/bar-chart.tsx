'use client';

import { useMemo } from 'react';

export interface BarChartDatum {
  key: string;
  label: string;
  total: number;
}

/** Gráfica de barras genérica (gradiente azul→verde), usada en Dashboard y Reportes. */
export function BarChart({ data, tooltipSuffix = '' }: { data: BarChartDatum[]; tooltipSuffix?: string }) {
  const max = useMemo(() => Math.max(1, ...data.map((d) => d.total)), [data]);
  const total = useMemo(() => data.reduce((s, d) => s + d.total, 0), [data]);

  if (data.length === 0) {
    return <div className="h-44 animate-pulse rounded-xl bg-slate-50" />;
  }

  if (total === 0) {
    return (
      <div className="flex h-44 items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-400">
        Sin citas en este periodo.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Nota: este contenedor NO debe usar `items-end` — eso evita que las
          columnas se estiren a h-40, y sin una altura de referencia definida
          la barra interna (con height en %) colapsa a 0px aunque haya datos. */}
      <div className="flex h-40 gap-3 border-b border-slate-100">
        {data.map((d, i) => {
          const color = lerpColor('#2563EB', '#10B981', data.length > 1 ? i / (data.length - 1) : 0);
          const h = d.total === 0 ? 0 : Math.max(4, (d.total / max) * 100);
          return (
            // relative + bottom en % (no un wrapper anidado) para no repetir
            // el bug: el label solo se posiciona, no participa en el cálculo
            // de altura de la barra.
            <div key={d.key} className="relative flex flex-1 items-end justify-center">
              <div
                className="w-full max-w-[42px] rounded-t-lg transition-all"
                style={{ height: `${h}%`, background: `linear-gradient(to top, ${color}, ${color}bb)` }}
                title={`${d.total}${tooltipSuffix ? ' ' + tooltipSuffix : ''}`}
              />
              {d.total > 0 && (
                <span
                  className="absolute left-1/2 -translate-x-1/2 text-xs font-semibold text-slate-500"
                  style={{ bottom: `calc(${h}% + 4px)` }}
                >
                  {d.total}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-3">
        {data.map((d) => (
          <span key={d.key} className="flex-1 text-center text-xs text-slate-400">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Devuelve HEX (no `rgb()`) porque el caller le concatena un sufijo alfa de
 * 2 dígitos (`${color}bb`) — eso solo es CSS válido en notación hex. */
function lerpColor(a: string, b: string, t: number): string {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const c = pa.map((v, i) => Math.round(v + (pb[i]! - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
