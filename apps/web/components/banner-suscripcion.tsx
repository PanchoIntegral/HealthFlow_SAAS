'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { rehidratarSuscripcion, useSuscripcionSuspendida } from '../lib/suscripcion';

/**
 * Aviso de suscripción vencida. Aparece en cuanto la API rechaza una escritura
 * con 402 y explica por qué no se pudo guardar — sin ese aviso, el usuario
 * solo vería que "no funciona".
 *
 * El botón lleva al portal de Stripe, que es el único camino para volver a
 * escribir. En cuanto pague, la primera escritura que pase baja el aviso sola.
 */
export function BannerSuscripcion() {
  const { token } = useAuth();
  const suspendida = useSuscripcionSuspendida();
  const [abriendo, setAbriendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => rehidratarSuscripcion(), []);

  if (!suspendida) return null;

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

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-6 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span aria-hidden className="text-amber-600">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <path d="M12 9v4M12 17h.01" />
          </svg>
        </span>
        <p className="text-sm text-amber-900">
          <span className="font-semibold">Tu suscripción está vencida.</span>{' '}
          Puedes seguir consultando la información de tus pacientes, pero no
          registrar cambios hasta regularizar el pago.
        </p>
        <button
          type="button"
          onClick={abrirPortal}
          disabled={abriendo}
          className="ml-auto rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:opacity-60"
        >
          {abriendo ? 'Abriendo…' : 'Regularizar pago'}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
