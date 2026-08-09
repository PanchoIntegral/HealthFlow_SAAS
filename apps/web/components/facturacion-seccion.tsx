'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FacturacionView, PagoView } from '@healthflow/shared-types';
import { api, ApiError } from '../lib/api';

/** Centavos → "$1,234.56". Mismo criterio de centavos que el resto del dominio. */
function dinero(centavos: number, moneda: string): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: moneda || 'MXN',
  }).format(centavos / 100);
}

function fechaLarga(iso: string): string {
  return new Date(iso).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Cómo se muestra cada estado de factura de Stripe. */
const ESTATUS: Record<string, { texto: string; clase: string }> = {
  paid: { texto: 'Pagado', clase: 'bg-emerald-50 text-emerald-700' },
  open: { texto: 'Pendiente', clase: 'bg-amber-50 text-amber-700' },
  uncollectible: { texto: 'Incobrable', clase: 'bg-red-50 text-red-700' },
  void: { texto: 'Anulado', clase: 'bg-slate-100 text-slate-500' },
  draft: { texto: 'Borrador', clase: 'bg-slate-100 text-slate-500' },
};

/**
 * Facturación de la clínica: plan, tarjeta e historial de cobros.
 *
 * Todo es de SOLO LECTURA. Cambiar la tarjeta o cancelar ocurre en el portal
 * de Stripe, no aquí: pedir un número de tarjeta en nuestra propia UI nos
 * metería en el alcance de PCI sin ganar nada, y Stripe ya resuelve ese flujo
 * mejor de lo que lo haríamos nosotros.
 */
export function FacturacionSeccion({ token }: { token: string }) {
  const [abriendo, setAbriendo] = useState(false);
  const [errorPortal, setErrorPortal] = useState<string | null>(null);

  const facturacion = useQuery({
    queryKey: ['facturacion'],
    queryFn: () => api.facturacion(token),
    retry: false,
  });

  const abrirPortal = async () => {
    setAbriendo(true);
    setErrorPortal(null);
    try {
      const { url } = await api.portalSession(token);
      window.location.href = url;
    } catch (err) {
      setErrorPortal(
        err instanceof ApiError
          ? err.message
          : 'No pudimos abrir el portal de facturación. Inténtalo de nuevo.',
      );
      setAbriendo(false);
    }
  };

  if (facturacion.isLoading) {
    return <p className="text-slate-400">Cargando facturación…</p>;
  }

  if (facturacion.isError) {
    const status = facturacion.error instanceof ApiError ? facturacion.error.status : undefined;
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
        {status === 403
          ? 'Solo el titular de la cuenta puede ver la facturación de la clínica.'
          : 'No pudimos cargar la facturación. Inténtalo de nuevo en un momento.'}
      </div>
    );
  }

  const d = facturacion.data as FacturacionView;

  return (
    <div className="space-y-4">
      {/* ── Cobro pendiente ──
          Va ARRIBA de todo y con el monto a la vista: si la clínica está
          suspendida, esto es lo único que le importa de esta pantalla. */}
      {d.pagoPendiente && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-amber-900">Tienes un cobro pendiente</p>
              <p className="mt-0.5 text-sm text-amber-800">
                {dinero(d.pagoPendiente.montoCentavos, d.pagoPendiente.moneda)}
                {d.pagoPendiente.venceEl && ` · vence el ${fechaLarga(d.pagoPendiente.venceEl)}`}
              </p>
            </div>
            {/* Enlace a la página de pago de Stripe, no un cobro disparado por
                nosotros: lo normal es que la tarjeta guardada haya fallado, así
                que hay que poder pagar con OTRA — y el 3DS lo resuelve el banco
                con el usuario delante. */}
            <a
              href={d.pagoPendiente.urlPago}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700"
            >
              Pagar ahora
            </a>
          </div>
          <p className="mt-3 text-xs text-amber-700">
            No tienes que esperar al siguiente intento automático de cobro. El pago se procesa en
            Stripe y tu cuenta se reactiva sola en cuanto se confirme.
          </p>
        </div>
      )}

      {/* ── Plan y método de pago ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Tu plan</p>
            <p className="text-lg font-bold capitalize">{d.plan}</p>
            <p className="mt-0.5 text-sm text-slate-500">
              Cobro {d.billingPeriod}
              {d.currentPeriodEnd && ` · se renueva el ${fechaLarga(d.currentPeriodEnd)}`}
            </p>
          </div>

          <button
            type="button"
            onClick={abrirPortal}
            disabled={abriendo || d.sinCliente}
            title={
              d.sinCliente ? 'Esta clínica no tiene una suscripción activa en Stripe' : undefined
            }
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-brand-blue hover:text-brand-blue disabled:opacity-50"
          >
            {abriendo ? 'Abriendo…' : 'Gestionar suscripción'}
          </button>
        </div>

        {errorPortal && <p className="mt-3 text-sm text-red-600">{errorPortal}</p>}

        <div className="mt-5 border-t border-slate-100 pt-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Método de pago
          </p>
          {d.metodoPago ? (
            <div className="mt-2 flex items-center gap-3">
              <span className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                {d.metodoPago.marca}
              </span>
              <span className="font-medium">•••• {d.metodoPago.ultimos4}</span>
              <span className="text-sm text-slate-400">
                Vence {String(d.metodoPago.expiraMes).padStart(2, '0')}/{d.metodoPago.expiraAnio}
              </span>
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500">
              {d.sinCliente
                ? 'Esta clínica no tiene una suscripción de pago registrada.'
                : 'Sin tarjeta guardada. Agrégala desde “Gestionar suscripción”.'}
            </p>
          )}
          {!d.sinCliente && (
            <p className="mt-3 text-xs text-slate-400">
              Los datos de la tarjeta se guardan en Stripe, nunca en HealthFlow. Para cambiarla usa
              “Gestionar suscripción”.
            </p>
          )}
        </div>
      </div>

      {/* ── Historial ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="font-semibold">Historial de pagos</h3>

        {!d.historialDisponible ? (
          // No es lo mismo "no hay cobros" que "no pudimos consultarlos", y en
          // una pantalla de dinero confundirlos es inaceptable.
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            No pudimos consultar tus cobros en este momento. Esto no significa que no existan —
            vuelve a intentarlo en unos minutos o revísalos en “Gestionar suscripción”.
          </p>
        ) : d.pagos.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Todavía no hay cobros registrados.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="pb-2 font-medium">Fecha</th>
                  <th className="pb-2 font-medium">Folio</th>
                  <th className="pb-2 font-medium">Estado</th>
                  <th className="pb-2 text-right font-medium">Monto</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {d.pagos.map((p) => (
                  <FilaPago key={p.id} pago={p} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function FilaPago({ pago }: { pago: PagoView }) {
  const estado = ESTATUS[pago.estatus] ?? {
    texto: pago.estatus,
    clase: 'bg-slate-100 text-slate-500',
  };

  return (
    <tr className="border-b border-slate-50 last:border-0">
      <td className="py-3 text-slate-600">{fechaLarga(pago.fecha)}</td>
      <td className="py-3 text-slate-400">{pago.numero ?? '—'}</td>
      <td className="py-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${estado.clase}`}>
          {estado.texto}
        </span>
      </td>
      <td className="py-3 text-right font-medium">{dinero(pago.montoCentavos, pago.moneda)}</td>
      <td className="py-3 text-right">
        {pago.urlRecibo && (
          <a
            href={pago.urlRecibo}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-brand-blue hover:underline"
          >
            Ver recibo
          </a>
        )}
      </td>
    </tr>
  );
}
