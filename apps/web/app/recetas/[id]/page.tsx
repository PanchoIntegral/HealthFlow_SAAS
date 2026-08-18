'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ETIQUETAS_SEXO, type RecetaDetalle } from '@healthflow/shared-types';
import { useAuth } from '../../../lib/auth';
import { api, ApiError } from '../../../lib/api';
import { IconPrinter } from '../../../components/icons';

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });

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

function HojaReceta({ receta }: { receta: RecetaDetalle }) {
  const { emisor, paciente, diagnosticos, medicamentos, indicacionesGenerales, alergiasSnapshot } =
    receta.contenido;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-8 text-sm print:rounded-none print:border-0 print:p-0">
      {/* La marca de cancelación se imprime TAMBIÉN en papel: ocultarla no
          borra la copia que ya circula, y quien reciba esta hoja tiene que
          poder ver que dejó de ser válida. */}
      {receta.cancelacion && (
        <div className="mb-6 rounded-lg border-2 border-red-600 px-4 py-3 text-center">
          <p className="text-base font-bold uppercase tracking-wide text-red-700">
            Receta cancelada
          </p>
          <p className="mt-0.5 text-xs text-red-700">
            {receta.cancelacion.motivo} · {fecha(receta.cancelacion.fecha)}
          </p>
        </div>
      )}

      <header className="mb-6 border-b border-slate-300 pb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Receta médica</p>
        <h1 className="mt-1 text-xl font-bold">{emisor.nombreClinica}</h1>
        {/* Se omite la línea entera si faltan los datos, en vez de imprimir
            "—": un membrete con guiones se ve como un documento a medias. */}
        {(emisor.domicilioEstablecimiento || emisor.telefonoClinica) && (
          <p className="mt-0.5 text-xs text-slate-500">
            {[
              emisor.domicilioEstablecimiento,
              emisor.telefonoClinica ? `Tel: ${emisor.telefonoClinica}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}

        <div className="mt-3 flex items-end justify-between gap-6">
          <div>
            <p className="font-semibold text-slate-800">{emisor.medicoNombre}</p>
            {emisor.especialidad && (
              <p className="text-xs text-slate-500">{emisor.especialidad}</p>
            )}
            {/* Los tres datos que exige el art. 64 del RIS, juntos. */}
            <p className="mt-0.5 text-xs text-slate-600">
              Céd. prof. {emisor.cedulaProfesional}
              {emisor.cedulaEspecialidad ? ` · Céd. esp. ${emisor.cedulaEspecialidad}` : ''}
            </p>
            <p className="text-xs text-slate-600">{emisor.institucionTitulo}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs uppercase tracking-wide text-slate-400">Folio</p>
            <p className="font-mono font-semibold text-slate-800">{receta.folio}</p>
            <p className="mt-0.5 text-xs text-slate-500">{fecha(receta.createdAt)}</p>
          </div>
        </div>
      </header>

      <section className="mb-5 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
        <Dato label="Paciente" ancho={2}>
          {paciente.nombre}
        </Dato>
        <Dato label="Edad">{paciente.edad} años</Dato>
        <Dato label="Sexo">{ETIQUETAS_SEXO[paciente.sexo]}</Dato>
      </section>

      {diagnosticos.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Diagnóstico
          </h2>
          {diagnosticos.map((d) => (
            <p key={d.cie10} className="text-slate-800">
              {d.descripcion} <span className="text-slate-400">({d.cie10})</span>
            </p>
          ))}
        </section>
      )}

      {alergiasSnapshot.length > 0 && (
        <section className="mb-5 rounded-lg border border-red-300 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Alergias</p>
          <p className="text-red-800">{alergiasSnapshot.join(' · ')}</p>
        </section>
      )}

      <section className="mb-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Prescripción
        </h2>
        <ol className="space-y-3">
          {medicamentos.map((m, i) => (
            // break-inside-avoid: un medicamento partido entre dos hojas es
            // exactamente el error que causa una dosis mal leída.
            <li key={i} className="break-inside-avoid border-l-2 border-slate-200 pl-3">
              <p className="font-semibold text-slate-900">
                {m.denominacionGenerica}
                {m.denominacionDistintiva && (
                  <span className="font-normal text-slate-500"> ({m.denominacionDistintiva})</span>
                )}
              </p>
              <p className="text-slate-700">{m.presentacion}</p>
              {/* Los datos del art. 29 en un renglón, en el orden en que se
                  leen en voz alta al paciente. */}
              <p className="text-slate-700">
                {m.dosis} · vía {m.via.toLowerCase()} · {m.frecuencia} · {m.duracion}
              </p>
              {m.indicaciones && (
                <p className="mt-0.5 text-xs italic text-slate-600">{m.indicaciones}</p>
              )}
            </li>
          ))}
        </ol>
      </section>

      {indicacionesGenerales && (
        <section className="mb-6 break-inside-avoid">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Indicaciones generales
          </h2>
          <p className="whitespace-pre-line text-slate-800">{indicacionesGenerales}</p>
        </section>
      )}

      <footer className="mt-16 break-inside-avoid">
        <div className="mx-auto w-72 border-t border-slate-400 pt-1 text-center text-xs text-slate-500">
          Firma autógrafa del médico
        </div>
      </footer>
    </article>
  );
}

/**
 * Las clases de ancho van literales y no interpoladas: Tailwind escanea el
 * código fuente y no detecta `sm:col-span-${n}`.
 */
function Dato({
  label,
  children,
  ancho = 1,
}: {
  label: string;
  children: React.ReactNode;
  ancho?: 1 | 2 | 4;
}) {
  const span = ancho === 4 ? 'sm:col-span-4' : ancho === 2 ? 'sm:col-span-2' : '';
  return (
    <div className={span}>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-slate-800">{children}</p>
    </div>
  );
}
