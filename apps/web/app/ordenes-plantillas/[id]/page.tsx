'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ETIQUETAS_SEXO,
  ETIQUETA_GRUPO_PLANTILLA,
  ETIQUETA_LADO,
  GRUPOS_PLANTILLA,
  PODOGRAMA_VACIO,
  VALORES_PLANTILLA,
  opcionesPlantillaDeGrupo,
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
 * Fecha SIN hora (`dateRequired` viene como YYYY-MM-DD del `<input type=date>`).
 * `new Date('2026-09-15')` la interpreta como medianoche UTC, que en México es
 * el día 14: la hoja le pedía al laboratorio la entrega un día antes de lo que
 * el médico capturó. Partirla a mano la deja en hora local.
 */
const fechaSolo = (ymd: string) => {
  const [a, m, d] = ymd.split('-').map(Number);
  return new Date(a!, m! - 1, d!).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

/**
 * Vista de impresión de la orden de plantillas. Ruta PROPIA y sin `AppShell` a
 * propósito: nada de barra lateral ni navegación debe colarse en la hoja que
 * termina en manos del laboratorio. "Exportar a PDF" no es un botón aparte —
 * es el diálogo de impresión del navegador (Guardar como PDF), que ya sabe
 * hacer esto sin que HealthFlow tenga que generar el PDF por su cuenta.
 *
 * La hoja reproduce el formato de papel COMPLETO —todas las casillas, marcadas
 * y sin marcar, y todas las líneas de posting aunque vengan vacías— y no solo
 * lo capturado. El laboratorio lee este formato por posición: una hoja con
 * únicamente las tres casillas marcadas no le dice si lo demás se omitió a
 * propósito o si el sistema lo perdió, y obliga a completar a mano lo que
 * falta. Ese fue justo el reporte que originó esta versión.
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
    <main className="mx-auto max-w-4xl px-6 py-8 print:max-w-full print:px-0 print:py-0">
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
    <article className="hoja-orden rounded-2xl border border-slate-200 bg-white p-8 text-sm print:rounded-none print:border-0 print:p-0">
      <header className="mb-4 border-b border-slate-300 pb-3">
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
      </header>

      {/* Encabezado de datos, en el mismo orden que la mitad superior de la
          hoja de papel: primero el médico que ordena, luego el paciente, luego
          la orden. */}
      <section className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1.5 border-b border-slate-200 pb-4 sm:grid-cols-4">
        <Dato label="Practitioner's Name" ancho={2}>
          {orden.doctorNombre}
          {orden.doctorCedula ? ` · céd. prof. ${orden.doctorCedula}` : ''}
          {orden.doctorCedulaEspecialidad ? ` · céd. esp. ${orden.doctorCedulaEspecialidad}` : ''}
        </Dato>
        <Dato label="Account #">{c.accountNumber}</Dato>
        <Dato label="Date">{fecha(orden.createdAt)}</Dato>

        <Dato label="Patient Name" ancho={2}>
          {orden.patientNombre}
        </Dato>
        <Dato label="Phone Number">{orden.patientTelefono}</Dato>
        <Dato label="Sex / Age">
          {[
            orden.patientSexo ? ETIQUETAS_SEXO[orden.patientSexo] : null,
            `${orden.patientEdad} años`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Dato>

        <Dato label="Shoe Size">{c.shoeSize}</Dato>
        <Dato label="Shoe Type">{c.shoeType}</Dato>
        <Dato label="Weight">{c.weight}</Dato>
        <Dato label="Date Required">{c.dateRequired ? fechaSolo(c.dateRequired) : null}</Dato>

        <Dato label="Diagnosis" ancho={4}>
          {c.diagnosis}
        </Dato>
        <div className="flex gap-6 text-[11px] sm:col-span-4">
          <Casilla marcada={c.returnCastToDr === true} texto="Return Cast to Dr" />
          <Casilla marcada={c.mailToPatient === true} texto="Mail to Patient" />
        </div>
      </section>

      {/* TODAS las casillas del formato, marcadas y sin marcar. El laboratorio
          lee esta hoja por posición: omitir los grupos vacíos —como hacía la
          versión anterior— deja una hoja que no se puede cotejar contra el
          formato de papel y obliga a completarla a mano. */}
      <div className="columnas-orden">
        {GRUPOS_PLANTILLA.map((grupo) => (
          <GrupoImpreso key={grupo} grupo={grupo} orden={orden} />
        ))}
        <ValoresImpresos orden={orden} />
      </div>

      {/* Siempre, aunque no tenga marcas: en papel el diagrama en blanco sirve
          para rayarlo a mano junto al paciente, que es exactamente lo que
          hacían cuando la hoja salía sin él. `modoImpresion` fuerza planta Y
          dorso a la vez — en papel no hay forma de "voltear" para ver la otra
          vista. */}
      <section className="mt-5 break-inside-avoid border-t border-slate-200 pt-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Mapa de pies
        </p>
        <Podograma valor={c.podograma ?? PODOGRAMA_VACIO} onChange={() => {}} readOnly modoImpresion />
      </section>

      <section className="mt-5 break-inside-avoid border-t border-slate-200 pt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Special Instructions and Diagnostic
        </p>
        {c.specialInstructions ? (
          <p className="mt-1 whitespace-pre-wrap text-slate-700">{c.specialInstructions}</p>
        ) : (
          // Renglones en blanco en vez de nada: es el espacio que el médico usa
          // para escribir a mano lo que no cabe en las casillas.
          <div className="mt-2 space-y-4">
            <div className="border-b border-slate-300" />
            <div className="border-b border-slate-300" />
            <div className="border-b border-slate-300" />
          </div>
        )}
      </section>

      <footer className="mt-6 border-t border-slate-200 pt-3 text-xs text-slate-400">
        {orden.estatus === 'completada' ? 'Completada' : orden.estatus === 'cancelada' ? 'Cancelada' : 'Borrador'} ·
        actualizada el {fecha(orden.updatedAt)}
      </footer>
    </article>
  );
}

function GrupoImpreso({ grupo, orden }: { grupo: GrupoPlantilla; orden: OrdenPlantillasDetalle }) {
  const c = orden.contenido;
  const opciones = opcionesPlantillaDeGrupo(grupo);
  if (opciones.length === 0) return null;

  return (
    <section className="mb-3 break-inside-avoid">
      <p className="border-b border-slate-300 pb-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
        {ETIQUETA_GRUPO_PLANTILLA[grupo]}
      </p>
      <ul className="mt-1 space-y-0.5">
        {opciones.map((o) =>
          o.porLado ? (
            <li key={o.key} className="flex items-baseline justify-between gap-2 text-[11px] leading-snug">
              <span className="text-slate-700">{o.label}</span>
              <span className="flex shrink-0 gap-1.5">
                {(['derecho', 'izquierdo'] as const).map((lado) => (
                  <Casilla
                    key={lado}
                    marcada={c.marcas.some((m) => m.opcion === o.key && m.lado === lado)}
                    texto={ETIQUETA_LADO[lado].charAt(0)}
                  />
                ))}
              </span>
            </li>
          ) : (
            <li key={o.key} className="text-[11px] leading-snug">
              <Casilla marcada={c.opciones.includes(o.key)} texto={o.label} />
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

function ValoresImpresos({ orden }: { orden: OrdenPlantillasDetalle }) {
  const valores = orden.contenido.valores;

  return (
    <section className="mb-3 break-inside-avoid">
      <p className="border-b border-slate-300 pb-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
        Posting y cobertura
      </p>
      {/* Todos los campos, con renglón en blanco cuando no se capturó: en la
          hoja de papel estas son líneas para rellenar, y dejarlas visibles es
          lo que permite completarlas junto al paciente. */}
      <ul className="mt-1 space-y-0.5">
        {VALORES_PLANTILLA.map((v) => (
          <li key={v.key} className="flex items-baseline gap-2 text-[11px] leading-snug">
            <span className="shrink-0 text-slate-500">{v.label}:</span>
            <span className="flex-1 border-b border-dotted border-slate-400 font-medium text-slate-800">
              {valores[v.key] ?? ' '}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Casilla del formato: ☑ / ☐, para que la hoja se lea igual que la de papel. */
function Casilla({ marcada, texto }: { marcada: boolean; texto: string }) {
  return (
    <span className={marcada ? 'font-semibold text-slate-900' : 'text-slate-600'}>
      <span className="mr-1">{marcada ? '☑' : '☐'}</span>
      {texto}
    </span>
  );
}

function Dato({ label, ancho = 1, children }: { label: string; ancho?: number; children: React.ReactNode }) {
  // Clases completas y literales a propósito: Tailwind detecta clases por
  // texto exacto en el build, y `sm:col-span-${ancho}` interpolado nunca se
  // generaría — quedaría sin estilo en producción aunque funcionara en dev.
  const spanClass = ancho === 4 ? 'sm:col-span-4' : ancho === 2 ? 'sm:col-span-2' : undefined;
  return (
    <div className={spanClass}>
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="border-b border-slate-200 text-slate-800">{children || ' '}</p>
    </div>
  );
}
