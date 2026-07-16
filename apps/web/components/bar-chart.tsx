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
  if (data.length === 0) {
    return <div className="h-40 animate-pulse rounded-xl bg-slate-50" />;
  }
  return (
    <div className="flex h-44 items-end justify-between gap-3">
      {data.map((d, i) => {
        const color = lerpColor('#2563EB', '#10B981', data.length > 1 ? i / (data.length - 1) : 0);
        const h = Math.max(6, (d.total / max) * 100);
        return (
          <div key={d.key} className="flex flex-1 flex-col items-center gap-2">
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-lg transition-all"
                style={{ height: `${h}%`, background: `linear-gradient(to top, ${color}, ${color}bb)` }}
                title={`${d.total}${tooltipSuffix ? ' ' + tooltipSuffix : ''}`}
              />
            </div>
            <span className="text-xs text-slate-400">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function lerpColor(a: string, b: string, t: number): string {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const c = pa.map((v, i) => Math.round(v + (pb[i]! - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
