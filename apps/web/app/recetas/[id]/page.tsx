'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../lib/auth';
import { api, ApiError } from '../../../lib/api';
import { IconPrinter } from '../../../components/icons';
import { HojaReceta } from '../../../components/hoja-receta';

/**
 * Hoja de impresión de la receta. Ruta PROPIA y sin `AppShell`, igual que la
 * orden de plantillas: nada de navegación debe colarse en el papel que se
 * lleva el paciente a la farmacia.
 *
 * La firma es AUTÓGRAFA: la hoja imprime la línea donde va y el médico firma.
 * El sistema no la simula — la receta electrónica está reconocida en la LGS
 * pero su reglamentación operativa sigue incompleta, así que el camino válido
 * hoy es papel firmado a mano.
 */
export default function RecetaPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <RecetaPrintPageInner key={id} id={id} />;
}

function RecetaPrintPageInner({ id }: { id: string }) {
  const router = useRouter();
  const { token, user, ready } = useAuth();

  useEffect(() => {
    if (ready && !token) router.replace('/login');
  }, [ready, token, router]);

  const receta = useQuery({
    queryKey: ['receta-detalle', id],
    queryFn: () => api.getReceta(token!, id),
    enabled: !!token,
    retry: false,
  });

  if (!ready || !token || !user) return null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 print:max-w-full print:px-0 print:py-0">
      <div className="no-print mb-6 flex items-center justify-between">
        <button
          onClick={() => router.back()}
          className="text-sm font-medium text-slate-500 hover:text-brand-blue"
        >
          ← Volver
        </button>
        {receta.data && (
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2 text-sm font-semibold text-white"
          >
            <IconPrinter size={16} />
            Imprimir / Guardar como PDF
          </button>
        )}
      </div>

      {receta.isLoading && <p className="text-sm text-slate-400">Cargando…</p>}

      {receta.isError && (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
          {receta.error instanceof ApiError && receta.error.status === 404
            ? 'Esta receta no existe o no pertenece a tu clínica.'
            : 'Error al cargar la receta.'}
        </p>
      )}

      {receta.data && <HojaReceta receta={receta.data} />}
    </main>
  );
}
