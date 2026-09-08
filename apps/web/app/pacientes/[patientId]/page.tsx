'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ClinicalNoteView,
  HistorialPaciente,
  SignosVitales,
} from '@healthflow/shared-types';
import { useAuth } from '../../../lib/auth';
import { api, ApiError } from '../../../lib/api';
import { useClinicaDental } from '../../../lib/use-clinica-dental';
import { AppShell } from '../../../components/app-shell';
import { AlertaAlergias } from '../../../components/alerta-alergias';
import { EditorHistorial } from '../../../components/editor-historial';
import { PresupuestoPanel } from '../../../components/presupuesto-panel';
import { ConsentimientoPanel } from '../../../components/consentimiento-panel';
import { RadiografiaPanel } from '../../../components/radiografia-panel';
import { Podograma } from '../../../components/podograma';
import { MapaCorporal } from '../../../components/mapa-corporal';
import { CorregirNotaModal } from '../../../components/corregir-nota-modal';
import { OrdenesPlantillasPanel } from '../../../components/ordenes-plantillas-panel';
import { RecetaPanel } from '../../../components/receta-panel';
import { FichaPaciente } from '../../../components/ficha-paciente';

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });

/** Expediente clínico completo de un paciente: todas sus notas, la más reciente primero. */
/**
 * Envoltura delgada que fuerza un remount completo al cambiar de paciente.
 *
 * Esta pantalla en particular no tiene hoy ningún estado que se "hidrate una
 * sola vez" (todo sale reactivo de `useInfiniteQuery`, cuya key ya incluye
 * `patientId`), así que no hay bug actual aquí. Pero Next.js App Router
 * reutiliza la instancia del componente de página al navegar entre dos URLs
 * de la misma ruta dinámica — ver el comentario largo en
 * `consulta/[appointmentId]/page.tsx`, donde ESE patrón sí causaba que la nota
 * de un paciente se guardara sobre la de otro. Mismo blindaje aquí, barato y
 * preventivo: que la próxima persona que agregue un `useState` a esta pantalla
 * no tenga que redescubrir el problema para no reintroducirlo.
 */
export default function ExpedientePage({
  params,
}: {
  params: Promise<{ patientId: string }>;
}) {
  const { patientId } = use(params);
  return <ExpedientePageInner key={patientId} patientId={patientId} />;
}

function ExpedientePageInner({ patientId }: { patientId: string }) {
  const router = useRouter();
  const { token, user, ready } = useAuth();
  const clinicaDental = useClinicaDental();

  useEffect(() => {
    if (ready && !token) router.replace('/login');
  }, [ready, token, router]);

  /**
   * Historial paginado por cursor: el expediente de un paciente crónico crece
   * sin techo (conservación NOM-004) y traerlo entero de golpe es lo que peor
   * envejece de esta pantalla. Se recorre por páginas, no se recorta: el botón
   * "Cargar más" llega hasta la primera nota.
   */
  const record = useInfiniteQuery({
    queryKey: ['clinical-record', patientId],
    queryFn: ({ pageParam }) =>
      api.getClinicalRecord(token!, patientId, { cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (ultima) => ultima.nextCursor,
    enabled: !!token,
    retry: false,
  });

  // La cabecera del expediente (nombre, alergias, total) es la misma en todas
  // las páginas: se lee de la primera. Las notas se concatenan.
  const expediente = record.data?.pages[0];
  const notas = record.data?.pages.flatMap((p) => p.notas) ?? [];

  const queryClient = useQueryClient();
  const [editando, setEditando] = useState(false);

  const guardarHistorial = useMutation({
    mutationFn: (h: HistorialPaciente) => api.updateHistorial(token!, patientId, h),
    onSuccess: () => {
      // Invalida en vez de escribir a mano: la alerta de la consulta lee de la
      // misma query, así que ambas pantallas quedan al día con un solo refetch.
      void queryClient.invalidateQueries({ queryKey: ['clinical-record', patientId] });
      setEditando(false);
    },
  });

  if (!ready || !token || !user) return null;

  return (
    <AppShell>
      <main className="mx-auto max-w-3xl px-8 py-8">
        <button
          onClick={() => router.push('/pacientes')}
          className="mb-4 text-sm font-medium text-slate-500 transition hover:text-brand-blue"
        >
          ← Expedientes
        </button>

        {record.isLoading && <p className="text-slate-400">Cargando expediente…</p>}

        {record.isError && (
          <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
            {record.error instanceof ApiError && record.error.status === 404
              ? 'Este paciente aún no tiene expediente (se crea en su primera consulta).'
              : record.error instanceof ApiError && record.error.status === 403
                ? 'No tienes permiso para ver contenido clínico.'
                : 'Error al cargar el expediente.'}
          </p>
        )}

        {expediente && (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-bold">{expediente.patientNombre}</h1>
              <p className="mb-2 text-sm text-slate-500">
                {/* El total es del expediente entero, no de lo ya cargado: en
                    un expediente clínico un conteo parcial engaña. */}
                Expediente abierto el {fecha(expediente.abiertoEn)} · {expediente.totalNotas}{' '}
                nota{expediente.totalNotas === 1 ? '' : 's'}
              </p>
              <FichaPaciente
                token={token}
                patientId={patientId}
                nombre={expediente.patientNombre}
                telefono={expediente.patientTelefono}
                fechaNacimiento={expediente.patientFechaNacimiento}
              />
            </div>

            {editando ? (
              <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="mb-4 font-semibold">Alergias y antecedentes</h2>
                <EditorHistorial
                  inicial={expediente.historial}
                  guardando={guardarHistorial.isPending}
                  onGuardar={(h) => guardarHistorial.mutate(h)}
                  onCancelar={() => setEditando(false)}
                />
                {guardarHistorial.isError && (
                  <p className="mt-3 text-sm text-red-600">
                    No se pudo guardar. Revisa tu conexión e intenta de nuevo.
                  </p>
                )}
              </section>
            ) : (
              <AlertaAlergias
                historial={expediente.historial}
                onCapturar={() => setEditando(true)}
              />
            )}

            {/* Cotización y cobranza. Va antes de las notas porque es lo que
                se consulta a diario: cuánto debe el paciente.

                Solo en clínicas dentales: el panel cotiza por pieza y sale del
                odontograma, así que en cualquier otra especialidad era una
                sección vacía con campos que no aplican. */}
            {clinicaDental && (
              <section className="mb-6">
                <h2 className="mb-3 font-semibold">Presupuestos</h2>
                <PresupuestoPanel token={token} patientId={patientId} />
              </section>
            )}

            <section className="mb-6">
              <h2 className="mb-3 font-semibold">Consentimientos</h2>
              <ConsentimientoPanel token={token} patientId={patientId} />
            </section>

            <section className="mb-6">
              <h2 className="mb-3 font-semibold">Radiografías</h2>
              <RadiografiaPanel
                token={token}
                patientId={patientId}
                puedeEliminar={user.rol === 'medico' || user.rol === 'admin'}
              />
            </section>

            <RecetaPanel
              token={token}
              patientId={patientId}
              pacienteNombre={expediente.patientNombre}
              historial={expediente.historial}
            />

            <OrdenesPlantillasPanel token={token} patientId={patientId} />

            {notas.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
                Sin notas todavía.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {notas.map((nota) => (
                  <NotaCard
                    key={nota.id}
                    nota={nota}
                    token={token}
                    patientId={patientId}
                    // Escribir una aclaración clínica firmada es acto médico:
                    // el asistente lee el expediente, pero no firma en él.
                    puedeCorregir={user.rol === 'medico' || user.rol === 'admin'}
                  />
                ))}

                {record.hasNextPage && (
                  <button
                    onClick={() => void record.fetchNextPage()}
                    disabled={record.isFetchingNextPage}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 transition hover:border-brand-blue hover:text-brand-blue disabled:opacity-50"
                  >
                    {record.isFetchingNextPage
                      ? 'Cargando…'
                      : `Cargar notas anteriores (${expediente.totalNotas - notas.length} restantes)`}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </AppShell>
  );
}

function NotaCard({
  nota,
  token,
  patientId,
  puedeCorregir,
}: {
  nota: ClinicalNoteView;
  token: string;
  patientId: string;
  puedeCorregir: boolean;
}) {
  const c = nota.contenido;
  const cerrada = nota.estatus === 'cerrada';
  const [corrigiendo, setCorrigiendo] = useState(false);

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <p className="font-semibold">
            {nota.tipoNota === 'historia_clinica' ? 'Historia clínica' : 'Nota de evolución'}
          </p>
          <p className="text-xs text-slate-500">{fecha(nota.cerradoEn ?? nota.createdAt)}</p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            cerrada ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          }`}
        >
          {cerrada ? 'Cerrada' : 'Borrador'}
        </span>
      </header>

      {c.diagnosticos.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {c.diagnosticos.map((d) => (
            <span
              key={d.cie10}
              className="rounded-full bg-brand-blue/10 px-2.5 py-1 text-xs font-medium text-brand-blue"
              title={d.descripcion}
            >
              {d.cie10} · {d.descripcion}
            </span>
          ))}
        </div>
      )}

      {nota.tipoNota === 'historia_clinica' && (
        <Section title="Antecedentes">
          <div className="space-y-2 text-sm text-slate-700">
            {c.antecedentesHeredofamiliares && (
              <p><span className="font-medium text-slate-500">Heredofamiliares: </span>{c.antecedentesHeredofamiliares}</p>
            )}
            {c.antecedentesPersonalesPatologicos && (
              <p><span className="font-medium text-slate-500">Patológicos: </span>{c.antecedentesPersonalesPatologicos}</p>
            )}
            {c.antecedentesPersonalesNoPatologicos && (
              <p><span className="font-medium text-slate-500">No patológicos: </span>{c.antecedentesPersonalesNoPatologicos}</p>
            )}
          </div>
        </Section>
      )}

      {c.padecimientoActual && (
        <Section title="Padecimiento actual">
          {/* HTML generado por TipTap dentro de la propia app */}
          <div
            className="hf-nota text-sm text-slate-700"
            dangerouslySetInnerHTML={{ __html: c.padecimientoActual }}
          />
        </Section>
      )}

      <Section title="Signos vitales">
        <VitalesGrid v={c.exploracionFisica.signosVitales} />
      </Section>

      {c.exploracionFisica.hallazgos && (
        <Section title="Hallazgos">
          <p className="text-sm text-slate-700">{c.exploracionFisica.hallazgos}</p>
        </Section>
      )}

      {c.planTerapeutico && (
        <Section title="Plan terapéutico">
          <p className="whitespace-pre-wrap text-sm text-slate-700">{c.planTerapeutico}</p>
        </Section>
      )}

      {/*
        Mapa de pies de la nota. Se muestra en el expediente y no solo durante
        la consulta porque es el hallazgo principal de podiatría: una nota de
        esta especialidad sin su diagrama es ilegible para quien la consulta
        después. Solo lectura — la nota cerrada es inmutable (NOM-004).
      */}
      {c.podograma && c.podograma.marcas.length > 0 && (
        <Section title="Mapa de pies">
          {/* El componente ya trae su propio resumen escrito de las marcas
              (ResumenPodograma): no se agrega otro aquí. */}
          <Podograma valor={c.podograma} onChange={() => {}} readOnly />
        </Section>
      )}

      {/* La localización visual forma parte de la nota firmada y debe poder
          consultarse desde el expediente, no sólo durante la curación. */}
      {c.mapaCorporal && c.mapaCorporal.marcas.length > 0 && (
        <Section title="Ubicación anatómica de heridas y estomas">
          <MapaCorporal valor={c.mapaCorporal} onChange={() => {}} readOnly />
        </Section>
      )}

      {c.firma && (
        <footer className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500">
          Firmada por <strong>{c.firma.medicoNombre}</strong>
          {c.firma.cedula ? ` · Céd. prof. ${c.firma.cedula}` : ''}
        </footer>
      )}

      {/*
        Correcciones posteriores al cierre. Van DEBAJO de la nota y su firma,
        nunca mezcladas con el texto original: quien lee el expediente debe
        poder distinguir de un vistazo qué se asentó en la consulta y qué se
        aclaró después (NOM-004: sin enmendaduras).
      */}
      {nota.correcciones.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          {nota.correcciones.map((corr) => (
            <div key={corr.id} className="rounded-lg bg-amber-50/60 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                Corrección
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{corr.texto}</p>
              <p className="mt-1 text-xs text-slate-500">
                {fecha(corr.createdAt)} · {corr.autorNombre}
                {corr.autorCedula ? ` · Céd. prof. ${corr.autorCedula}` : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      {cerrada && puedeCorregir && (
        <button
          onClick={() => setCorrigiendo(true)}
          className="mt-3 text-xs font-medium text-brand-blue hover:underline"
        >
          + Agregar corrección
        </button>
      )}

      {corrigiendo && (
        <CorregirNotaModal
          token={token}
          noteId={nota.id}
          patientId={patientId}
          onClose={() => setCorrigiendo(false)}
        />
      )}
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </h3>
      {children}
    </div>
  );
}

const VITALES: { key: keyof SignosVitales; label: string; unidad: string }[] = [
  { key: 'ta', label: 'T/A', unidad: 'mmHg' },
  { key: 'fc', label: 'FC', unidad: 'lpm' },
  { key: 'fr', label: 'FR', unidad: 'rpm' },
  { key: 'temp', label: 'Temp', unidad: '°C' },
  { key: 'spo2', label: 'SpO₂', unidad: '%' },
  { key: 'peso', label: 'Peso', unidad: 'kg' },
  { key: 'talla', label: 'Talla', unidad: 'm' },
];

function VitalesGrid({ v }: { v: SignosVitales }) {
  const conValor = VITALES.filter(({ key }) => v[key]);
  if (conValor.length === 0) {
    return <p className="text-sm text-slate-400">No registrados.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {conValor.map(({ key, label, unidad }) => (
        <div key={key} className="rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
          <span className="text-slate-400">{label}: </span>
          <span className="font-medium text-slate-700">
            {v[key]} {unidad}
          </span>
        </div>
      ))}
    </div>
  );
}
