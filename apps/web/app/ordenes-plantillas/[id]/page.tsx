'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ETIQUETA_GRUPO_PLANTILLA,
  ETIQUETA_LADO,
  GRUPOS_PLANTILLA,
  PODOGRAMA_VACIO,
  opcionPlantillaPorKey,
  opcionesPlantillaDeGrupo,
  valorPlantillaPorKey,
  type GrupoPlantilla,
  type OrdenPlantillasDetalle,
} from '@healthflow/shared-types';
import { useAuth } from '../../../lib/auth';
import { api, ApiError } from '../../../lib/api';
import { IconPrinter } from '../../../components/icons';
import { Podograma } from '../../../components/podograma';

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Vista de impresión de la orden de plantillas. Ruta PROPIA y sin `AppShell` a
 * propósito: nada de barra lateral ni navegación debe colarse en la hoja que
 * termina en manos del laboratorio. "Exportar a PDF" no es un botón aparte —
 * es el diálogo de impresión del navegador (Guardar como PDF), que ya sabe
 * hacer esto sin que HealthFlow tenga que generar el PDF por su cuenta.
 */
export default function OrdenPlantillasPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <OrdenPlantillasPrintPageInner key={id} id={id} />;
}

function OrdenPlantillasPrintPageInner({ id }: { id: string }) {
  const router = useRouter();
  const { token, user, ready } = useAuth();

  useEffect(() => {
    if (ready && !token) router.replace('/login');
  }, [ready, token, router]);

  const orden = useQuery({
    queryKey: ['orden-plantillas-detalle', id],
    queryFn: () => api.getOrdenPlantillasDetalle(token!, id),
    enabled: !!token,
    retry: false,
  });

  if (!ready || !token || !user) return null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 print:max-w-full print:px-0 print:py-0">
      <div className="no-print mb-6 flex items-center justify-between">
        <button onClick={() => router.back()} className="text-sm font-medium text-slate-500 hover:text-brand-blue">
          ← Volver
        </button>
        {orden.data && (
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2 text-sm font-semibold text-white"
          >
            <IconPrinter size={16} />
            Imprimir / Guardar como PDF
          </button>
        )}
      </div>

      {orden.isLoading && <p className="text-sm text-slate-400">Cargando…</p>}

      {orden.isError && (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
          {orden.error instanceof ApiError && orden.error.status === 404
            ? 'Esta orden no existe o no pertenece a tu clínica.'
            : 'Error al cargar la orden.'}
        </p>
      )}

      {orden.data && <HojaOrden orden={orden.data} />}
    </main>
  );
}

function HojaOrden({ orden }: { orden: OrdenPlantillasDetalle }) {
  const c = orden.contenido;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-8 text-sm print:rounded-none print:border-0 print:p-0">
      <header className="mb-6 border-b border-slate-300 pb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Orden de plantillas ortopédicas · Microrthopedic Solutions
        </p>
        <h1 className="mt-1 text-xl font-bold">{orden.nombreClinica}</h1>
        {/* Dirección y teléfono, igual que un membrete de papel: sin esto, la
            hoja no dice a dónde regresarle el caso al médico. Ninguno de los
            dos es obligatorio a propósito (ver Ajustes) — si el titular no los
            capturó, se omite la línea entera en vez de imprimir "—". */}
        {(orden.direccionClinica || orden.telefonoClinica) && (
          <p className="mt-0.5 text-xs text-slate-500">
            {[orden.direccionClinica, orden.telefonoClinica ? `Tel: ${orden.telefonoClinica}` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-slate-600 sm:grid-cols-4">
          <Dato label="Practitioner">
            {orden.doctorNombre}
            {orden.doctorCedula ? ` · céd. prof. ${orden.doctorCedula}` : ''}
            {orden.doctorCedulaEspecialidad ? ` · céd. esp. ${orden.doctorCedulaEspecialidad}` : ''}
          </Dato>
          <Dato label="Patient">{orden.patientNombre}</Dato>
          <Dato label="Date">{fecha(orden.createdAt)}</Dato>
          <Dato label="Date Required">{c.dateRequired ? fecha(c.dateRequired) : '—'}</Dato>
        </div>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
        <Dato label="Shoe Size">{c.shoeSize || '—'}</Dato>
        <Dato label="Shoe Type">{c.shoeType || '—'}</Dato>
        <Dato label="Weight">{c.weight || '—'}</Dato>
        <Dato label="Account #">{c.accountNumber || '—'}</Dato>
        <Dato label="Diagnosis" ancho={4}>
          {c.diagnosis || '—'}
        </Dato>
        <Dato label="Return Cast to Dr">{c.returnCastToDr ? 'Sí' : 'No'}</Dato>
        <Dato label="Mail to Patient">{c.mailToPatient ? 'Sí' : 'No'}</Dato>
      </section>

      {/* Solo los grupos con algo marcado: una hoja en blanco no le sirve al
          laboratorio, y reimprimir las 99 casillas vacías la haría ilegible. */}
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 print:grid-cols-2">
        {GRUPOS_PLANTILLA.map((grupo) => (
          <GrupoImpreso key={grupo} grupo={grupo} orden={orden} />
        ))}
      </div>

      <ValoresImpresos orden={orden} />

      {/* Mismo criterio que el resto de la hoja: solo se imprime si hay algo
          marcado. `modoImpresion` fuerza planta Y dorso a la vez —en papel no
          hay forma de "voltear" para ver la otra vista. */}
      {c.podograma && c.podograma.marcas.length > 0 && (
        <section className="mt-6 border-t border-slate-200 pt-4 break-inside-avoid">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Mapa de pies
          </p>
          <Podograma valor={c.podograma ?? PODOGRAMA_VACIO} onChange={() => {}} readOnly modoImpresion />
        </section>
      )}

      {c.specialInstructions && (
        <section className="mt-6 border-t border-slate-200 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Special Instructions and Diagnostic
          </p>
          <p className="mt-1 whitespace-pre-wrap text-slate-700">{c.specialInstructions}</p>
        </section>
      )}

      <footer className="mt-8 border-t border-slate-200 pt-4 text-xs text-slate-400">
        {orden.estatus === 'completada' ? 'Completada' : orden.estatus === 'cancelada' ? 'Cancelada' : 'Borrador'} ·
        actualizada el {fecha(orden.updatedAt)}
      </footer>
    </article>
  );
}

function GrupoImpreso({ grupo, orden }: { grupo: GrupoPlantilla; orden: OrdenPlantillasDetalle }) {
  const c = orden.contenido;
  const opciones = opcionesPlantillaDeGrupo(grupo);

  const lineas = opciones
    .map((o) => {
      if (o.porLado) {
        const lados = (['derecho', 'izquierdo'] as const).filter((lado) =>
          c.marcas.some((m) => m.opcion === o.key && m.lado === lado),
        );
        if (lados.length === 0) return null;
        return `${o.label} — ${lados.map((l) => ETIQUETA_LADO[l]).join(' y ')}`;
      }
      return c.opciones.includes(o.key) ? o.label : null;
    })
    .filter((l): l is string => l !== null);

  if (lineas.length === 0) return null;

  return (
    <section className="break-inside-avoid">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {ETIQUETA_GRUPO_PLANTILLA[grupo]}
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-700">
        {lineas.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </section>
  );
}

function ValoresImpresos({ orden }: { orden: OrdenPlantillasDetalle }) {
  const entradas = Object.entries(orden.contenido.valores).filter(([, v]) => v);
  if (entradas.length === 0) return null;

  return (
    <section className="mt-6 border-t border-slate-200 pt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Posting y cobertura</p>
      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        {entradas.map(([key, valor]) => (
          <Dato key={key} label={valorPlantillaPorKey(key)?.label ?? key}>
            {valor}
          </Dato>
        ))}
      </div>
    </section>
  );
}

function Dato({ label, ancho = 1, children }: { label: string; ancho?: number; children: React.ReactNode }) {
  // Clases completas y literales a propósito: Tailwind detecta clases por
  // texto exacto en el build, y `sm:col-span-${ancho}` interpolado nunca se
  // generaría — quedaría sin estilo en producción aunque funcionara en dev.
  const spanClass = ancho === 4 ? 'sm:col-span-4' : undefined;
  return (
    <div className={spanClass}>
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-slate-800">{children}</p>
    </div>
  );
}
