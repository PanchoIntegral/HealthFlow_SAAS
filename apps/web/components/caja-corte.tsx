'use client';

import type {
  MetodoPago,
  MovimientoCajaView,
  ResumenCaja,
  TipoMovimientoCaja,
} from '@healthflow/shared-types';
import { pesos } from './presupuesto-panel';

export const ETIQUETA_TIPO: Record<TipoMovimientoCaja, string> = {
  ingreso: 'Ingreso',
  egreso: 'Egreso',
  retiro: 'Retiro',
};

export const ETIQUETA_METODO: Record<MetodoPago, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  otro: 'Otro',
};

const COLOR_TIPO: Record<TipoMovimientoCaja, string> = {
  ingreso: 'bg-emerald-50 text-emerald-700',
  egreso: 'bg-rose-50 text-rose-700',
  retiro: 'bg-slate-100 text-slate-600',
};

export const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

export const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString('es-MX', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * El corte de caja. Se usa igual para el turno abierto (donde `diferencia` es
 * `null` porque nadie ha contado todavía) y para el reporte de un turno ya
 * cerrado — es el mismo cálculo y debe verse igual en los dos lados.
 */
export function CorteResumen({ resumen }: { resumen: ResumenCaja }) {
  const { diferenciaCentavos: diferencia } = resumen;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Ingresos" valor={resumen.ingresosCentavos} tono="verde" />
        <Kpi titulo="Egresos" valor={resumen.egresosCentavos} tono="rojo" />
        <Kpi titulo="Retiros" valor={resumen.retirosCentavos} tono="neutro" />
        <Kpi
          titulo="Efectivo esperado"
          valor={resumen.efectivoEsperadoCentavos}
          tono="azul"
          nota={`Incluye ${pesos(resumen.fondoInicialCentavos)} de fondo inicial`}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">
            Ingresos por método
          </p>
          <ul className="space-y-1.5 text-sm">
            {(Object.keys(ETIQUETA_METODO) as MetodoPago[]).map((m) => (
              <li key={m} className="flex justify-between">
                <span className="text-slate-500">{ETIQUETA_METODO[m]}</span>
                <span className="font-medium tabular-nums">
                  {pesos(resumen.ingresosPorMetodo[m])}
                </span>
              </li>
            ))}
          </ul>
          {/* Lo cobrado con tarjeta o transferencia nunca pasó por el cajón:
              este desglose es lo que se concilia contra la terminal y el banco. */}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">
            Arqueo del efectivo
          </p>
          {diferencia === null ? (
            <p className="text-sm text-slate-400">
              El efectivo se cuenta al cerrar la caja. Hasta entonces solo hay un esperado.
            </p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              <li className="flex justify-between">
                <span className="text-slate-500">Esperado</span>
                <span className="tabular-nums">{pesos(resumen.efectivoEsperadoCentavos)}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-slate-500">Contado</span>
                <span className="tabular-nums">{pesos(resumen.efectivoContadoCentavos ?? 0)}</span>
              </li>
              <li className="flex justify-between border-t border-slate-100 pt-1.5 font-semibold">
                <span>Diferencia</span>
                <span
                  className={`tabular-nums ${
                    diferencia === 0
                      ? 'text-slate-900'
                      : diferencia < 0
                        ? 'text-rose-600'
                        : 'text-amber-600'
                  }`}
                >
                  {diferencia > 0 ? '+' : ''}
                  {pesos(diferencia)}
                </span>
              </li>
            </ul>
          )}
          {diferencia !== null && diferencia !== 0 && (
            <p className="mt-2 text-xs text-slate-400">
              {diferencia < 0 ? 'Falta dinero en el cajón.' : 'Sobra dinero en el cajón.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({
  titulo,
  valor,
  tono,
  nota,
}: {
  titulo: string;
  valor: number;
  tono: 'verde' | 'rojo' | 'azul' | 'neutro';
  nota?: string;
}) {
  const color = {
    verde: 'text-emerald-600',
    rojo: 'text-rose-600',
    azul: 'text-brand-blue',
    neutro: 'text-slate-700',
  }[tono];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{titulo}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{pesos(valor)}</p>
      {nota && <p className="mt-1 text-xs text-slate-400">{nota}</p>}
    </div>
  );
}

/**
 * Movimientos del turno. Los cancelados se quedan en la lista, tachados: el
 * corte tiene que poder explicar qué se capturó de más y quién lo anuló.
 */
export function TablaMovimientos({
  movimientos,
  acciones,
}: {
  movimientos: MovimientoCajaView[];
  /** Columna de acciones por movimiento; sin ella la tabla es solo lectura. */
  acciones?: (m: MovimientoCajaView) => React.ReactNode;
}) {
  if (movimientos.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-400">
        Sin movimientos en este turno.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-6 py-3 font-medium">Hora</th>
              <th className="px-6 py-3 font-medium">Tipo</th>
              <th className="px-6 py-3 font-medium">Concepto</th>
              <th className="px-6 py-3 font-medium">Paciente</th>
              <th className="px-6 py-3 font-medium">Método</th>
              <th className="px-6 py-3 font-medium">Registró</th>
              <th className="px-6 py-3 text-right font-medium">Monto</th>
              {acciones && <th className="px-6 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {movimientos.map((m) => {
              const cancelado = m.canceladoEn !== null;
              return (
                <tr key={m.id} className={cancelado ? 'bg-slate-50/60 text-slate-400' : ''}>
                  <td className="whitespace-nowrap px-6 py-3 text-slate-500">{hora(m.createdAt)}</td>
                  <td className="px-6 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        cancelado ? 'bg-slate-100 text-slate-400' : COLOR_TIPO[m.tipo]
                      }`}
                    >
                      {ETIQUETA_TIPO[m.tipo]}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <span className={cancelado ? 'line-through' : 'font-medium'}>{m.concepto}</span>
                    {m.abonoId && (
                      <span className="ml-2 rounded bg-brand-blue/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand-blue">
                        Abono
                      </span>
                    )}
                    {cancelado && (
                      <p className="mt-0.5 text-xs">
                        Cancelado por {m.canceladoPorNombre} — {m.motivoCancelacion}
                      </p>
                    )}
                    {m.referencia && !cancelado && (
                      <p className="mt-0.5 text-xs text-slate-400">Ref. {m.referencia}</p>
                    )}
                  </td>
                  <td className="px-6 py-3 text-slate-500">{m.patientNombre ?? '—'}</td>
                  <td className="px-6 py-3 text-slate-500">{ETIQUETA_METODO[m.metodo]}</td>
                  <td className="px-6 py-3 text-slate-500">{m.registradoPorNombre}</td>
                  <td
                    className={`whitespace-nowrap px-6 py-3 text-right font-semibold tabular-nums ${
                      cancelado ? 'line-through' : m.tipo === 'ingreso' ? 'text-emerald-700' : 'text-slate-700'
                    }`}
                  >
                    {m.tipo === 'ingreso' ? '' : '−'}
                    {pesos(m.montoCentavos)}
                  </td>
                  {acciones && (
                    <td className="whitespace-nowrap px-6 py-3 text-right">
                      {cancelado ? null : acciones(m)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
