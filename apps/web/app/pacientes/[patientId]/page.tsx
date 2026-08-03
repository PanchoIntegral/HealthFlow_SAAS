'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ClinicalNoteView,
  HistorialPaciente,
  SignosVitales,
} from '@healthflow/shared-types';
import { useAuth } from '../../../lib/auth';
import { api, ApiError } from '../../../lib/api';
import { AppShell } from '../../../components/app-shell';
import { AlertaAlergias } from '../../../components/alerta-alergias';
import { EditorHistorial } from '../../../components/editor-historial';
import { PresupuestoPanel } from '../../../components/presupuesto-panel';

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });

/** Expediente clínico completo de un paciente: todas sus notas, la más reciente primero. */
export default function ExpedientePage({
  params,
}: {
  params: Promise<{ patientId: string }>;
}) {
  const { patientId } = use(params);
  const router = useRouter();
  const { token, user, ready } = useAuth();

  useEffect(() => {
    if (ready && !token) router.replace('/login');
  }, [ready, token, router]);

  const record = useQuery({
    queryKey: ['clinical-record', patientId],
    queryFn: () => api.getClinicalRecord(token!, patientId),
    enabled: !!token,
    retry: false,
  });

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

        {record.data && (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-bold">{record.data.patientNombre}</h1>
              <p className="text-sm text-slate-500">
                Expediente abierto el {fecha(record.data.abiertoEn)} · {record.data.notas.length}{' '}
                nota{record.data.notas.length === 1 ? '' : 's'}
              </p>
            </div>

            {editando ? (
              <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="mb-4 font-semibold">Alergias y antecedentes</h2>
                <EditorHistorial
                  inicial={record.data.historial}
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
                historial={record.data.historial}
                onCapturar={() => setEditando(true)}
              />
            )}

            {/* Cotización y cobranza. Va antes de las notas porque es lo que
                se consulta a diario: cuánto debe el paciente. */}
            <section className="mb-6">
              <h2 className="mb-3 font-semibold">Presupuestos</h2>
              <PresupuestoPanel token={token} patientId={patientId} />
            </section>

            {record.data.notas.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
                Sin notas todavía.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {record.data.notas.map((nota) => (
                  <NotaCard key={nota.id} nota={nota} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </AppShell>
  );
}

function NotaCard({ nota }: { nota: ClinicalNoteView }) {
  const c = nota.contenido;
  const cerrada = nota.estatus === 'cerrada';

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <p className="font-semibold">Nota de evolución</p>
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

      {c.padecimientoActual && (
        <Section title="Padecimiento actual">
          {/* HTML generado por TipTap dentro de la propia app */}
          <div
            className="prose prose-sm max-w-none text-slate-700"
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

      {c.firma && (
        <footer className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500">
          Firmada por <strong>{c.firma.medicoNombre}</strong>
          {c.firma.cedula ? ` · Céd. prof. ${c.firma.cedula}` : ''}
        </footer>
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
