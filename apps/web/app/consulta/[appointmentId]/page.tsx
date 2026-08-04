'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  EMPTY_NOTA_EVOLUCION,
  ODONTOGRAMA_VACIO,
  partidasDesdeOdontograma,
  perfilDe,
  type CampoBaseKey,
  type Odontograma as OdontogramaData,
  type DiagnosticoCie10,
  type NotaEvolucionContent,
  type PerfilEspecialidad,
  type PresupuestoView,
  type SignosVitales,
} from '@healthflow/shared-types';
import { useAuth } from '../../../lib/auth';
import { api, ApiError } from '../../../lib/api';
import { RichTextEditor } from '../../../components/rich-text-editor';
import { CamposEspecialidad } from '../../../components/campos-especialidad';
import { AlertaAlergias } from '../../../components/alerta-alergias';
import { Odontograma } from '../../../components/odontograma';
import { NuevoPresupuestoModal } from '../../../components/nuevo-presupuesto-modal';
import { pesos } from '../../../components/presupuesto-panel';

/** Etiqueta de cada signo vital. Qué subconjunto se muestra lo decide el perfil. */
const ETIQUETA_VITAL: Record<keyof SignosVitales, string> = {
  ta: 'T/A (mmHg)',
  fc: 'FC (lpm)',
  fr: 'FR (rpm)',
  temp: 'Temp (°C)',
  spo2: 'SpO₂ (%)',
  peso: 'Peso (kg)',
  talla: 'Talla (m)',
};

/** Texto por defecto de los campos base, cuando la especialidad no lo reescribe. */
const ETIQUETA_BASE: Record<CampoBaseKey, { label: string; placeholder?: string }> = {
  padecimientoActual: {
    label: 'Padecimiento actual',
    placeholder: 'Describir inicio, evolución y síntomas asociados…',
  },
  hallazgos: { label: 'Hallazgos', placeholder: '' },
  diagnosticos: { label: 'Diagnósticos (CIE-10)' },
  planTerapeutico: {
    label: 'Plan terapéutico',
    placeholder: 'Medicamentos, indicaciones, próxima cita…',
  },
};

/** Etiqueta efectiva de un campo base: la de la especialidad si la define. */
function textoDe(perfil: PerfilEspecialidad, campo: CampoBaseKey) {
  return { ...ETIQUETA_BASE[campo], ...(perfil.etiquetas?.[campo] ?? {}) };
}

/**
 * Norma que rige la nota. NOM-004 es la base de todo expediente clínico, pero
 * el odontológico se rige además por la NOM-013-SSA2-2015 — y decirle NOM-004
 * a secas a un dentista es información incorrecta en pantalla.
 */
function normaDe(perfil: PerfilEspecialidad): string {
  return perfil.key === 'odontologia'
    ? 'NOM-004-SSA3-2012 · NOM-013-SSA2-2015'
    : 'NOM-004-SSA3-2012';
}

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

  // Presupuesto creado desde la consulta, sin salir a registrar alergias primero.
  const [modalPresupuesto, setModalPresupuesto] = useState(false);
  const [presupuestoCreado, setPresupuestoCreado] = useState<PresupuestoView | null>(null);

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

  /**
   * El perfil sale de la NOTA, no del médico conectado: una nota firmada hace
   * seis meses debe seguir mostrando los campos con los que se firmó, aunque
   * su autor haya cambiado de especialidad desde entonces.
   */
  const perfil = useMemo(() => perfilDe(content.especialidad), [content.especialidad]);
  const progress = useMemo(() => computeProgress(content, perfil), [content, perfil]);
  /** La bandera sola no basta: la especialidad tiene que permitirlo. */
  const omitidos = perfil.permiteOmitirSignosVitales === true && content.signosVitalesOmitidos === true;

  if (!ready || !token || !user) return null;

  const puedeCotizar = (user.rol === 'medico' || user.rol === 'admin') && !!patientId;

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

  const setCampoExtra = (key: string, valor: string | number | null) =>
    setContent((c) => ({ ...c, extension: { ...(c.extension ?? {}), [key]: valor } }));

  /** Actualización funcional: no pierde marcas si llegan varios clics seguidos. */
  const setOdontograma = (actualizar: (previo: OdontogramaData) => OdontogramaData) =>
    setContent((c) => ({ ...c, odontograma: actualizar(c.odontograma ?? ODONTOGRAMA_VACIO) }));

  /** Al desmarcar se limpia el motivo: no debe quedar huérfano en la nota. */
  const setOmision = (activo: boolean) =>
    setContent((c) => ({
      ...c,
      signosVitalesOmitidos: activo,
      motivoOmisionSignosVitales: activo ? c.motivoOmisionSignosVitales : undefined,
    }));

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
              {content.tipoNota === 'historia_clinica' ? 'Historia clínica' : 'Nota de evolución'} ·{' '}
              {normaDe(perfil)} {readOnly && '· cerrada'}
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
          {/* Lo primero que se ve, antes que cualquier campo: si el paciente es
              alérgico a algo hay que saberlo ANTES de infiltrar, no después. */}
          {record.data && (
            <AlertaAlergias
              historial={record.data.historial}
              onCapturar={patientId ? () => router.push(`/pacientes/${patientId}`) : undefined}
            />
          )}

          {missing.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              Faltan {missing.length} campo(s) obligatorio(s) para poder firmar.
            </div>
          )}

          {content.tipoNota === 'historia_clinica' && (
            <Section
              title="Antecedentes"
              required
              missing={
                isMissing('antecedentesHeredofamiliares') ||
                isMissing('antecedentesPersonalesPatologicos') ||
                isMissing('antecedentesPersonalesNoPatologicos')
              }
            >
              <div className="space-y-3">
                <CampoAntecedente
                  label="Heredofamiliares"
                  value={content.antecedentesHeredofamiliares ?? ''}
                  onChange={(v) => setContent((c) => ({ ...c, antecedentesHeredofamiliares: v }))}
                  readOnly={readOnly}
                  missing={isMissing('antecedentesHeredofamiliares')}
                />
                <CampoAntecedente
                  label="Personales patológicos"
                  value={content.antecedentesPersonalesPatologicos ?? ''}
                  onChange={(v) => setContent((c) => ({ ...c, antecedentesPersonalesPatologicos: v }))}
                  readOnly={readOnly}
                  missing={isMissing('antecedentesPersonalesPatologicos')}
                />
                <CampoAntecedente
                  label="Personales no patológicos"
                  placeholder="Hábitos, higiene, vacunación…"
                  value={content.antecedentesPersonalesNoPatologicos ?? ''}
                  onChange={(v) => setContent((c) => ({ ...c, antecedentesPersonalesNoPatologicos: v }))}
                  readOnly={readOnly}
                  missing={isMissing('antecedentesPersonalesNoPatologicos')}
                />
              </div>
            </Section>
          )}

          <Section title="Padecimiento actual" required missing={isMissing('padecimientoActual')}>
            <RichTextEditor
              value={content.padecimientoActual}
              onChange={(html) => setContent((c) => ({ ...c, padecimientoActual: html }))}
              editable={!readOnly}
              placeholder={textoDe(perfil, 'padecimientoActual').placeholder}
            />
          </Section>

          <Section
            title="Exploración física · Signos vitales"
            required={!omitidos}
            missing={isMissing('signosVitales.ta')}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {/* El perfil decide CUÁLES y en qué orden; 'ta' va siempre porque
                  NOM-004 la exige para cerrar en cualquier especialidad. */}
              {perfil.signosVitales.map((key) => (
                <label key={key} className="text-sm">
                  <span className="mb-1 block text-xs font-medium text-slate-500">
                    {ETIQUETA_VITAL[key]}{' '}
                    {key === 'ta' && !omitidos && <span className="text-red-500">*</span>}
                  </span>
                  <input
                    value={content.exploracionFisica.signosVitales[key] ?? ''}
                    onChange={(e) => setVital(key, e.target.value)}
                    disabled={readOnly || omitidos}
                    className={`w-full rounded-lg border px-3 py-2 outline-none focus:border-brand-blue disabled:bg-slate-50 disabled:text-slate-400 ${
                      key === 'ta' && isMissing('signosVitales.ta') ? 'border-red-300' : 'border-slate-300'
                    }`}
                  />
                </label>
              ))}
            </div>

            {/* Escape declarado, solo donde el perfil lo permite. No vuelve el
                campo opcional: cambia "no lo llené" por "decidí no tomarlos",
                que es lo que queda escrito en el expediente. */}
            {perfil.permiteOmitirSignosVitales && (
              <div className="mt-4 rounded-lg bg-slate-50 p-3">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={omitidos}
                    disabled={readOnly}
                    onChange={(e) => setOmision(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    No se tomaron signos vitales en esta consulta
                    <span className="mt-0.5 block text-xs text-slate-500">
                      Queda asentado en la nota. Recuerda que la NOM-013 los pide al inicio de cada
                      cita, y la T/A es la revisión previa a cualquier anestesia con vasoconstrictor.
                    </span>
                  </span>
                </label>

                {omitidos && (
                  <input
                    value={content.motivoOmisionSignosVitales ?? ''}
                    onChange={(e) =>
                      setContent((c) => ({ ...c, motivoOmisionSignosVitales: e.target.value }))
                    }
                    disabled={readOnly}
                    placeholder="Motivo (opcional): revisión sin procedimiento, paciente no coopera…"
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue disabled:bg-slate-50"
                  />
                )}
              </div>
            )}

            {/* Hallazgos de la exploración. Cada especialidad lo reetiqueta a
                lo suyo: "Exploración bucal", "Examen mental", etc. */}
            <div className="mt-4">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                {textoDe(perfil, 'hallazgos').label}
              </span>
              <textarea
                value={content.exploracionFisica.hallazgos ?? ''}
                onChange={(e) =>
                  setContent((c) => ({
                    ...c,
                    exploracionFisica: { ...c.exploracionFisica, hallazgos: e.target.value },
                  }))
                }
                disabled={readOnly}
                rows={3}
                placeholder={textoDe(perfil, 'hallazgos').placeholder}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-blue disabled:bg-slate-50"
              />
            </div>
          </Section>

          {/* Solo donde tiene sentido: el odontograma lo dibuja el catálogo de
              la especialidad, no un `if` suelto en la página. */}
          {perfil.key === 'odontologia' && (
            <Section title="Odontograma">
              <div className="mb-3 flex items-center gap-2 text-xs">
                <label className="text-slate-500">Dentición</label>
                <select
                  value={content.odontograma?.denticion ?? 'permanente'}
                  onChange={(e) =>
                    setOdontograma((previo) => ({
                      ...previo,
                      denticion: e.target.value as 'permanente' | 'temporal' | 'mixta',
                    }))
                  }
                  disabled={readOnly}
                  className="rounded-lg border border-slate-300 px-2 py-1 outline-none focus:border-brand-blue disabled:bg-slate-50"
                >
                  <option value="permanente">Permanente</option>
                  <option value="temporal">Temporal (infantil)</option>
                </select>
              </div>
              <Odontograma
                valor={content.odontograma ?? ODONTOGRAMA_VACIO}
                onChange={setOdontograma}
                readOnly={readOnly}
              />
              {!readOnly && patientId && (
                <PresupuestarHallazgos
                  token={token}
                  patientId={patientId}
                  odontograma={content.odontograma ?? ODONTOGRAMA_VACIO}
                />
              )}
            </Section>
          )}

          {perfil.camposExtra.length > 0 && (
            <Section
              title={perfil.nombre}
              missing={missing.some((m) => m.startsWith('extension.'))}
            >
              <CamposEspecialidad
                campos={perfil.camposExtra}
                valores={content.extension ?? {}}
                onChange={setCampoExtra}
                readOnly={readOnly}
                faltantes={missing}
              />
            </Section>
          )}

          <Section title={textoDe(perfil, 'diagnosticos').label} required missing={isMissing('diagnosticos')}>
            <DiagnosticoPicker
              token={token}
              seleccionados={content.diagnosticos}
              onAdd={addDiagnostico}
              onRemove={removeDiagnostico}
              readOnly={readOnly}
            />
          </Section>

          <Section title={textoDe(perfil, 'planTerapeutico').label} required missing={isMissing('planTerapeutico')}>
            <textarea
              value={content.planTerapeutico}
              onChange={(e) => setContent((c) => ({ ...c, planTerapeutico: e.target.value }))}
              disabled={readOnly}
              rows={4}
              placeholder={textoDe(perfil, 'planTerapeutico').placeholder}
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

          {/* Cotizar sin salir de la consulta: antes había que ir al
              expediente (y de paso a la alerta de alergias) solo para armar
              un presupuesto. Aquí queda a un clic. */}
          {puedeCotizar && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Presupuesto
              </p>
              {presupuestoCreado ? (
                <div className="rounded-lg bg-emerald-50 p-3 text-emerald-800">
                  <p className="font-medium">{presupuestoCreado.titulo} creado</p>
                  <p className="text-xs">Total {pesos(presupuestoCreado.totalCentavos)}</p>
                  <a
                    href={`/pacientes/${patientId}`}
                    className="mt-1 inline-block text-xs font-medium underline hover:text-emerald-900"
                  >
                    Ver en el expediente →
                  </a>
                </div>
              ) : (
                <>
                  <p className="mb-3 text-xs text-slate-400">
                    Cotiza el tratamiento sin salir de la nota.
                  </p>
                  <button
                    onClick={() => setModalPresupuesto(true)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:border-brand-blue hover:text-brand-blue"
                  >
                    + Nuevo presupuesto
                  </button>
                </>
              )}
            </div>
          )}
        </aside>
      </div>

      {modalPresupuesto && patientId && (
        <NuevoPresupuestoModal
          token={token}
          paciente={{ id: patientId, nombre: record.data?.patientNombre ?? 'Paciente' }}
          onClose={() => setModalPresupuesto(false)}
          onCreado={(p) => setPresupuestoCreado(p)}
        />
      )}
    </div>
  );
}

/**
 * Convierte los hallazgos marcados en un presupuesto borrador.
 *
 * Está aquí, dentro de la consulta, porque es el momento en que el dentista
 * tiene la boca del paciente enfrente y sabe qué hay que hacer. Obligarlo a ir
 * al expediente y recapturar pieza por pieza es donde se pierde la venta.
 */
function PresupuestarHallazgos({
  token,
  patientId,
  odontograma,
}: {
  token: string;
  patientId: string;
  odontograma: OdontogramaData;
}) {
  const router = useRouter();
  const sugeridas = useMemo(() => partidasDesdeOdontograma(odontograma), [odontograma]);

  const crear = useMutation({
    mutationFn: () =>
      api.crearPresupuesto(token, {
        patientId,
        titulo: 'Plan de tratamiento',
        partidas: sugeridas,
      }),
    // Se manda al expediente porque ahí es donde se ponen los precios y se
    // presenta al paciente; el presupuesto nace en borrador y sin importes.
    onSuccess: () => router.push(`/pacientes/${patientId}`),
  });

  if (sugeridas.length === 0) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3">
      <div className="text-sm">
        <p className="font-medium">
          {sugeridas.length} hallazgo{sugeridas.length === 1 ? '' : 's'} por tratar
        </p>
        <p className="text-xs text-slate-500">
          {sugeridas.map((p) => `${p.descripcion} ${p.piezas?.[0]}`).join(' · ')}
        </p>
      </div>
      <button
        type="button"
        onClick={() => crear.mutate()}
        disabled={crear.isPending}
        className="ml-auto rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {crear.isPending ? 'Creando…' : 'Presupuestar'}
      </button>
      {crear.isError && (
        <p className="w-full text-sm text-red-600">No se pudo crear el presupuesto.</p>
      )}
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

function CampoAntecedente({
  label,
  placeholder,
  value,
  onChange,
  readOnly,
  missing,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  missing?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-slate-500">
        {label} <span className="text-red-500">*</span>
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={readOnly}
        rows={2}
        placeholder={placeholder}
        className={`w-full rounded-lg border px-3 py-2 outline-none focus:border-brand-blue disabled:bg-slate-50 ${
          missing ? 'border-red-300' : 'border-slate-300'
        }`}
      />
    </label>
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

/**
 * Progreso hacia poder cerrar la nota. Cuenta la base NOM-004 MÁS los campos
 * que la especialidad marque como obligatorios, para que la barra refleje lo
 * que de verdad va a exigir el backend al firmar.
 */
function computeProgress(
  c: NotaEvolucionContent,
  perfil: PerfilEspecialidad,
): { done: number; total: number } {
  const extension = c.extension ?? {};
  // Misma regla que EspecialidadValidator: declarar la omisión cuenta como
  // resuelto, para que la barra no se quede clavada en un requisito que el
  // backend ya no va a exigir.
  const omitidos = perfil.permiteOmitirSignosVitales === true && c.signosVitalesOmitidos === true;
  const checks = [
    stripHtml(c.padecimientoActual).length > 0,
    omitidos || !!c.exploracionFisica.signosVitales.ta?.trim(),
    c.diagnosticos.some((d) => d.cie10?.trim()),
    c.planTerapeutico.trim().length > 0,
    ...perfil.camposExtra
      .filter((campo) => campo.obligatorio)
      .map((campo) => tieneValor(extension[campo.key])),
    ...(c.tipoNota === 'historia_clinica'
      ? [
          tieneValor(c.antecedentesHeredofamiliares),
          tieneValor(c.antecedentesPersonalesPatologicos),
          tieneValor(c.antecedentesPersonalesNoPatologicos),
        ]
      : []),
  ];
  return { done: checks.filter(Boolean).length, total: checks.length };
}

/** Misma regla que el backend (ver especialidad-validator.ts): 0 cuenta como lleno. */
function tieneValor(v: string | number | null | undefined): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  return stripHtml(v).length > 0;
}

function hace(date: Date): string {
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  if (s < 5) return 'ahora';
  if (s < 60) return `hace ${s}s`;
  return `hace ${Math.round(s / 60)}min`;
}
