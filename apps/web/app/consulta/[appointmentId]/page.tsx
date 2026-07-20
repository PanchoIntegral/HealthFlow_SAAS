'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  EMPTY_NOTA_EVOLUCION,
  type DiagnosticoCie10,
  type NotaEvolucionContent,
  type SignosVitales,
} from '@healthflow/shared-types';
import { useAuth } from '../../../lib/auth';
import { api, ApiError } from '../../../lib/api';
import { RichTextEditor } from '../../../components/rich-text-editor';

const VITALES: { key: keyof SignosVitales; label: string; required?: boolean }[] = [
  { key: 'ta', label: 'T/A (mmHg)', required: true },
  { key: 'fc', label: 'FC (lpm)' },
  { key: 'fr', label: 'FR (rpm)' },
  { key: 'temp', label: 'Temp (°C)' },
  { key: 'spo2', label: 'SpO₂ (%)' },
  { key: 'peso', label: 'Peso (kg)' },
  { key: 'talla', label: 'Talla (m)' },
];

export default function ConsultaPage({
  params,
}: {
  params: Promise<{ appointmentId: string }>;
}) {
  const { appointmentId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const patientId = searchParams.get('patientId');
  const { token, user, ready } = useAuth();

  const [content, setContent] = useState<NotaEvolucionContent>(EMPTY_NOTA_EVOLUCION);
  const [missing, setMissing] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    if (ready && !token) router.replace('/login');
  }, [ready, token, router]);

  const note = useQuery({
    queryKey: ['note', appointmentId],
    queryFn: () => api.getConsultationNote(token!, appointmentId),
    enabled: !!token,
  });

  const record = useQuery({
    queryKey: ['clinical-record', patientId],
    queryFn: () => api.getClinicalRecord(token!, patientId!),
    enabled: !!token && !!patientId,
  });

  // Hidrata el contenido local una vez con lo que traiga el borrador.
  useEffect(() => {
    if (note.data && !hydrated.current) {
      setContent({ ...EMPTY_NOTA_EVOLUCION, ...note.data.contenido });
      hydrated.current = true;
    }
  }, [note.data]);

  const readOnly = note.data?.estatus === 'cerrada';

  const saveDraft = useMutation({
    mutationFn: (c: NotaEvolucionContent) => api.saveNoteDraft(token!, appointmentId, c),
    onSuccess: () => setSavedAt(new Date()),
  });

  // Autosave con debounce mientras la nota sea borrador.
  useEffect(() => {
    if (!hydrated.current || readOnly || !token) return;
    const t = setTimeout(() => saveDraft.mutate(content), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  const finish = useMutation({
    mutationFn: () => api.finishConsultation(token!, appointmentId, content),
    onSuccess: () => router.push('/sala-de-espera'),
    onError: (err) => {
      if (err instanceof ApiError && Array.isArray((err.body as { missing?: string[] })?.missing)) {
        setMissing((err.body as { missing: string[] }).missing);
      } else {
        alert(err instanceof ApiError ? err.message : 'Error al cerrar la nota');
      }
    },
  });

  const progress = useMemo(() => computeProgress(content), [content]);

  if (!ready || !token || !user) return null;

  const isMissing = (field: string) => missing.includes(field);
  const setVital = (key: keyof SignosVitales, value: string) =>
    setContent((c) => ({
      ...c,
      exploracionFisica: {
        ...c.exploracionFisica,
        signosVitales: { ...c.exploracionFisica.signosVitales, [key]: value || null },
      },
    }));

  const addDiagnostico = (d: DiagnosticoCie10) =>
    setContent((c) =>
      c.diagnosticos.some((x) => x.cie10 === d.cie10)
        ? c
        : { ...c, diagnosticos: [...c.diagnosticos, d] },
    );
  const removeDiagnostico = (cie10: string) =>
    setContent((c) => ({ ...c, diagnosticos: c.diagnosticos.filter((d) => d.cie10 !== cie10) }));

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Encabezado */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/sala-de-espera')} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">
            ← Sala
          </button>
          <div>
            <p className="font-semibold">{record.data?.patientNombre ?? 'Consulta'}</p>
            <p className="text-xs text-slate-500">
              Nota de evolución · NOM-004-SSA3-2012 {readOnly && '· cerrada'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {!readOnly && (
            <span className="text-slate-400">
              {saveDraft.isPending ? 'Guardando…' : savedAt ? `Guardado ${hace(savedAt)}` : 'Autoguardado activo'}
            </span>
          )}
          {!readOnly && (
            <button
              onClick={() => finish.mutate()}
              disabled={finish.isPending}
              className="rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2 font-semibold text-white transition hover:opacity-95 disabled:opacity-50"
            >
              {finish.isPending ? 'Cerrando…' : '✓ Firmar y cerrar'}
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-6 px-6 py-6 lg:grid-cols-[1fr_280px]">
        {/* Columna del editor */}
        <div className="space-y-5">
          {missing.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              Faltan {missing.length} campo(s) obligatorio(s) para poder firmar.
            </div>
          )}

          <Section title="Padecimiento actual" required missing={isMissing('padecimientoActual')}>
            <RichTextEditor
              value={content.padecimientoActual}
              onChange={(html) => setContent((c) => ({ ...c, padecimientoActual: html }))}
              editable={!readOnly}
              placeholder="Describir inicio, evolución y síntomas asociados…"
            />
          </Section>

          <Section title="Exploración física · Signos vitales" required missing={isMissing('signosVitales.ta')}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {VITALES.map((v) => (
                <label key={v.key} className="text-sm">
                  <span className="mb-1 block text-xs font-medium text-slate-500">
                    {v.label} {v.required && <span className="text-red-500">*</span>}
                  </span>
                  <input
                    value={content.exploracionFisica.signosVitales[v.key] ?? ''}
                    onChange={(e) => setVital(v.key, e.target.value)}
                    disabled={readOnly}
                    className={`w-full rounded-lg border px-3 py-2 outline-none focus:border-brand-blue disabled:bg-slate-50 ${
                      v.required && isMissing('signosVitales.ta') ? 'border-red-300' : 'border-slate-300'
                    }`}
                  />
                </label>
              ))}
            </div>
          </Section>

          <Section title="Diagnósticos (CIE-10)" required missing={isMissing('diagnosticos')}>
            <DiagnosticoPicker
              token={token}
              seleccionados={content.diagnosticos}
              onAdd={addDiagnostico}
              onRemove={removeDiagnostico}
              readOnly={readOnly}
            />
          </Section>

          <Section title="Plan terapéutico" required missing={isMissing('planTerapeutico')}>
            <textarea
              value={content.planTerapeutico}
              onChange={(e) => setContent((c) => ({ ...c, planTerapeutico: e.target.value }))}
              disabled={readOnly}
              rows={4}
              placeholder="Medicamentos, indicaciones, próxima cita…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-blue disabled:bg-slate-50"
            />
          </Section>
        </div>

        {/* Panel lateral */}
        <aside className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Progreso</p>
            <div className="mb-1 flex items-center justify-between">
              <span className="font-semibold">{progress.done} de {progress.total} secciones</span>
              <span className="text-slate-400">{Math.round((progress.done / progress.total) * 100)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full bg-gradient-to-r from-brand-blue to-brand-green" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
            {readOnly && note.data?.contenido.firma && (
              <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-emerald-800">
                <p className="font-medium">Firmada</p>
                <p className="text-xs">{note.data.contenido.firma.medicoNombre} · céd. {note.data.contenido.firma.cedula ?? '—'}</p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Consultas previas</p>
            {record.data && record.data.notas.filter((n) => n.estatus === 'cerrada' && n.appointmentId !== appointmentId).length > 0 ? (
              <ul className="space-y-2">
                {record.data.notas
                  .filter((n) => n.estatus === 'cerrada' && n.appointmentId !== appointmentId)
                  .slice(0, 3)
                  .map((n) => (
                    <li key={n.id} className="border-l-2 border-slate-200 pl-2 text-slate-600">
                      <p className="text-xs text-slate-400">
                        {n.cerradoEn ? new Date(n.cerradoEn).toLocaleDateString('es-MX') : ''}
                      </p>
                      <p className="text-xs">
                        {(n.contenido.diagnosticos ?? []).map((d) => d.cie10).join(', ') || 'Sin diagnósticos'}
                      </p>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-400">Primera consulta registrada.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Section({
  title,
  required,
  missing,
  children,
}: {
  title: string;
  required?: boolean;
  missing?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`rounded-2xl border bg-white p-5 ${missing ? 'border-red-300' : 'border-slate-200'}`}>
      <h2 className="mb-3 font-semibold">
        {title} {required && <span className="text-xs font-normal text-amber-600">· Obligatorio</span>}
      </h2>
      {children}
    </section>
  );
}

function DiagnosticoPicker({
  token,
  seleccionados,
  onAdd,
  onRemove,
  readOnly,
}: {
  token: string;
  seleccionados: DiagnosticoCie10[];
  onAdd: (d: DiagnosticoCie10) => void;
  onRemove: (cie10: string) => void;
  readOnly?: boolean;
}) {
  const [q, setQ] = useState('');

  // Debounce ligero para no disparar una búsqueda por cada tecla (mismo
  // patrón que el buscador de pacientes).
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const busqueda = useQuery({
    queryKey: ['cie10', debounced],
    queryFn: () => api.buscarCie10(token, debounced),
    enabled: debounced.trim().length >= 2,
  });
  const resultados = busqueda.data ?? [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {seleccionados.map((d) => (
          <span key={d.cie10} className="inline-flex items-center gap-2 rounded-lg bg-brand-blue/10 px-2.5 py-1 text-sm text-brand-blue">
            <strong>{d.cie10}</strong> {d.descripcion}
            {!readOnly && (
              <button onClick={() => onRemove(d.cie10)} className="text-brand-blue/60 hover:text-brand-blue">✕</button>
            )}
          </span>
        ))}
        {seleccionados.length === 0 && <span className="text-sm text-slate-400">Sin diagnósticos.</span>}
      </div>
      {!readOnly && (
        <div className="relative">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar diagnóstico o código CIE-10…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-blue"
          />
          {debounced.trim().length >= 2 && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
              {busqueda.isFetching ? (
                <li className="px-3 py-2 text-sm text-slate-400">Buscando…</li>
              ) : resultados.length > 0 ? (
                resultados.map((d) => (
                  <li key={d.cie10}>
                    <button
                      onClick={() => {
                        onAdd(d);
                        setQ('');
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                    >
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold">{d.cie10}</span>
                      {d.descripcion}
                    </button>
                  </li>
                ))
              ) : (
                <li className="px-3 py-2 text-sm text-slate-400">Sin resultados.</li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function computeProgress(c: NotaEvolucionContent): { done: number; total: number } {
  const checks = [
    stripHtml(c.padecimientoActual).length > 0,
    !!c.exploracionFisica.signosVitales.ta?.trim(),
    c.diagnosticos.some((d) => d.cie10?.trim()),
    c.planTerapeutico.trim().length > 0,
  ];
  return { done: checks.filter(Boolean).length, total: checks.length };
}

function hace(date: Date): string {
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  if (s < 5) return 'ahora';
  if (s < 60) return `hace ${s}s`;
  return `hace ${Math.round(s / 60)}min`;
}
