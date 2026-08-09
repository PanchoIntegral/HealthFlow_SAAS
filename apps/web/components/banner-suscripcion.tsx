'use client';

import { useEffect, useState } from 'react';
import type { AvisoSuscripcion, PagoPendienteView } from '@healthflow/shared-types';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { rehidratarSuscripcion, useSuscripcionSuspendida } from '../lib/suscripcion';

/**
 * Aviso de problemas con el pago, en dos tiempos.
 *
 *  - ADVERTENCIA: un cobro falló y corren los días de gracia. La cuenta sigue
 *    funcionando por completo, pero el usuario ya sabe hasta cuándo.
 *  - SUSPENDIDA: se agotó la gracia. La cuenta está en solo lectura.
 *
 * Los dos modos existen porque el 402 llega tarde por definición: solo se
 * dispara con la gracia YA agotada, así que durante esos días el usuario no se
 * enteraba de nada y un día cualquiera dejaba de poder guardar. La advertencia
 * es además lo que exige la cláusula 5.3 de los términos, que promete avisar
 * antes de restringir el acceso.
 *
 * El modo lo decide el servidor (GET /users/me → `suscripcion.aviso`, derivado
 * de common/subscription/debe-restringir.ts). Aquí no se recalcula ningún
 * umbral: si el banner tuviera su propia idea de cuándo empieza la suspensión,
 * se separaría de la del gating al primer cambio de política.
 *
 * El 402 se conserva como señal complementaria: cubre el hueco entre la lectura
 * al montar y una suspensión que ocurra con la pantalla ya abierta.
 */
export function BannerSuscripcion() {
  const { token, user } = useAuth();
  const suspendidaPor402 = useSuscripcionSuspendida();
  const [estado, setEstado] = useState<{ aviso: AvisoSuscripcion; graceUntil: string | null } | null>(null);
  const [pagoPendiente, setPagoPendiente] = useState<PagoPendienteView | null>(null);
  const [abriendo, setAbriendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => rehidratarSuscripcion(), []);

  useEffect(() => {
    if (!token) return;
    let vigente = true;
    api
      .getMyProfile(token)
      .then(({ suscripcion }) => {
        if (vigente) setEstado(suscripcion);
      })
      .catch(() => {
        // Si esta lectura falla no se inventa un aviso: un banner de cobranza
        // falso por un error de red asusta más de lo que ayuda. El 402 sigue
        // cubriendo el caso grave.
      });
    return () => {
      vigente = false;
    };
  }, [token]);

  // El 402 gana sobre la lectura: si la API acaba de rechazar una escritura, la
  // cuenta está suspendida AHORA, aunque al montar la pantalla no lo estuviera.
  const aviso: AvisoSuscripcion = suspendidaPor402 ? 'suspendida' : (estado?.aviso ?? 'ok');

  /**
   * La factura pendiente solo se consulta cuando SÍ hay un aviso y quien mira
   * es el titular: el endpoint es suyo (403 para el resto) y pedirlo en cada
   * pantalla, para todos, sería una llamada a Stripe por gusto.
   */
  const esTitular = user?.rol === 'admin';
  useEffect(() => {
    if (!token || !esTitular || aviso === 'ok') return;
    let vigente = true;
    api
      .facturacion(token)
      .then((f) => {
        if (vigente) setPagoPendiente(f.pagoPendiente);
      })
      .catch(() => {
        // Sin factura que ofrecer se cae al portal, que siempre funciona.
      });
    return () => {
      vigente = false;
    };
  }, [token, esTitular, aviso]);

  if (aviso === 'ok') return null;

  const suspendida = aviso === 'suspendida';
  const limite = formatearFecha(estado?.graceUntil ?? null);

  const abrirPortal = async () => {
    if (!token) return;
    setAbriendo(true);
    setError(null);
    try {
      const { url } = await api.portalSession(token);
      window.location.href = url;
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'No pudimos abrir el portal de pago. Inténtalo de nuevo.',
      );
      setAbriendo(false);
    }
  };

  // Ámbar para la advertencia (algo que atender) y rojo para la suspensión (algo
  // que ya te está limitando): el color tiene que distinguir los dos estados sin
  // que haya que leer el texto.
  const c = suspendida
    ? { borde: 'border-red-200', fondo: 'bg-red-50', icono: 'text-red-600', texto: 'text-red-900', boton: 'bg-red-600 hover:bg-red-700' }
    : { borde: 'border-amber-200', fondo: 'bg-amber-50', icono: 'text-amber-600', texto: 'text-amber-900', boton: 'bg-amber-600 hover:bg-amber-700' };

  return (
    <div className={`border-b ${c.borde} ${c.fondo} px-6 py-3`} role="status">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span aria-hidden className={c.icono}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <path d="M12 9v4M12 17h.01" />
          </svg>
        </span>
        <p className={`text-sm ${c.texto}`}>
          {suspendida ? (
            <>
              <span className="font-semibold">Tu suscripción está vencida.</span>{' '}
              Puedes seguir consultando la información de tus pacientes, pero no
              registrar cambios hasta regularizar el pago.
            </>
          ) : limite ? (
            <>
              <span className="font-semibold">No pudimos procesar tu pago.</span>{' '}
              Tienes hasta el {limite} para regularizarlo. Después de esa fecha
              podrás seguir consultando la información de tus pacientes, pero no
              registrar cambios.
            </>
          ) : (
            <>
              <span className="font-semibold">Hay un problema con tu pago.</span>{' '}
              Regularízalo para que tu cuenta no pase a solo lectura.
            </>
          )}
        </p>
        {/* Con una factura abierta, el camino corto: un clic a la página de
            pago de Stripe, sin pasar por el portal ni esperar el reintento
            automático. El portal queda como alternativa para cambiar la
            tarjeta o revisar el detalle. */}
        {pagoPendiente ? (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={abrirPortal}
              disabled={abriendo}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-60 ${c.texto} hover:underline`}
            >
              {abriendo ? 'Abriendo…' : 'Ver detalle'}
            </button>
            <a
              href={pagoPendiente.urlPago}
              target="_blank"
              rel="noopener noreferrer"
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition ${c.boton}`}
            >
              Pagar {dineroCorto(pagoPendiente.montoCentavos, pagoPendiente.moneda)}
            </a>
          </div>
        ) : (
          <button
            type="button"
            onClick={abrirPortal}
            disabled={abriendo}
            className={`ml-auto rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition disabled:opacity-60 ${c.boton}`}
          >
            {abriendo ? 'Abriendo…' : 'Regularizar pago'}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

/** "$899" — sin centavos: en un botón de banner el monto es para reconocerlo, no para cuadrar. */
function dineroCorto(centavos: number, moneda: string): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: moneda || 'MXN',
    maximumFractionDigits: 0,
  }).format(centavos / 100);
}

/** "14 de agosto de 2026". Sin hora: el plazo se vive en días, no en minutos. */
function formatearFecha(iso: string | null): string | null {
  if (!iso) return null;
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return null;
  return fecha.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
}
