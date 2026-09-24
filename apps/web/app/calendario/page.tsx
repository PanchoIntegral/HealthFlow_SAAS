'use client';

import 'react-big-calendar/lib/css/react-big-calendar.css';

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Calendar,
  dateFnsLocalizer,
  type SlotInfo,
  type ToolbarProps,
  type View,
} from 'react-big-calendar';
import { format, getDay, parse, startOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import type { AppointmentStatus, AppointmentView, PatientSummary } from '@healthflow/shared-types';
import { useAuth } from '../../lib/auth';
import { api, ApiError } from '../../lib/api';
import { useFormatoHora } from '../../lib/use-formato-hora';
import { calendarFormats, formatearHora, type FormatoHora } from '../../lib/formato-hora';
import { AppShell } from '../../components/app-shell';
import { STATUS_HEX, STATUS_LABEL, STATUS_TINT } from '../../components/status-badge';

/** Estatus que se muestran como etiqueta de texto en el chip (accionables); el resto solo lleva el punto de color. */
const STATUS_WITH_LABEL: AppointmentStatus[] = ['en_espera', 'en_consulta'];

const VIEW_LABELS: Record<View, string> = {
  month: 'Mes',
  week: 'Semana',
  day: 'Día',
  work_week: 'Semana laboral',
  agenda: 'Agenda',
};

/**
 * Ventana visible del grid de horas y alto del calendario. Juntos definen los
 * pixeles-por-minuto, que es lo que decide si una cita cabe con su nombre o no:
 * con las 24 h en 680px una cita de 30 min medía 14px y el nombre no entraba.
 * Con 7–21 h en 900px la hora mide ~53px, así que una cita de 60 min pasa el
 * umbral de tres líneas y una de 30 min tiene alto de sobra para su línea única.
 */
const HORARIO_MIN = new Date(1970, 0, 1, 7, 0);
const HORARIO_MAX = new Date(1970, 0, 1, 21, 0);
const CALENDAR_HEIGHT = 900;

/**
 * Umbrales del chip, en píxeles reales del bloque — no en minutos de duración:
 * los mismos 30 min miden distinto en Semana que en Día, y es el tamaño en
 * pantalla el que determina qué texto cabe.
 *
 * `alturaTresLineas` decide si el chip se despliega a tres líneas (hora, nombre,
 * motivo) o se resuelve en una sola. Los de ancho deciden cuánto texto entra en
 * esa línea: en Semana una columna mide ~117px y ahí no caben ni el rango
 * horario completo ni la etiqueta de estatus.
 */
const CHIP_PX = {
  alturaTresLineas: 48,
  /** Bajo este ancho solo cabe el apellido, y el punto de estatus cede su espacio al nombre. */
  anchoNombreAbreviado: 125,
  anchoNombreCompleto: 150,
  anchoEtiquetaEstatus: 175,
  anchoRangoHorario: 200,
} as const;

const LEGEND_STATUSES: AppointmentStatus[] = [
  'agendada',
  'en_espera',
  'en_consulta',
  'finalizada',
  'cancelada',
];

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { locale: es }),
  getDay,
  locales: { es },
});

const MESSAGES = {
  today: 'Hoy',
  previous: '← Anterior',
  next: 'Siguiente →',
  month: 'Mes',
  week: 'Semana',
  day: 'Día',
  agenda: 'Agenda',
  date: 'Fecha',
  time: 'Hora',
  event: 'Cita',
  noEventsInRange: 'No hay citas en este rango.',
  showMore: (total: number) => `+ ${total} más`,
};

interface CalEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource: AppointmentView;
}

export default function CalendarioPage() {
  return (
    <Suspense fallback={null}>
      <CalendarioContent />
    </Suspense>
  );
}

function CalendarioContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const formatoHora = useFormatoHora();
  const formats = useMemo(() => calendarFormats(formatoHora), [formatoHora]);

  const [view, setView] = useState<View>('week');
  const [range, setRange] = useState(() => weekRange(new Date()));
  const [selected, setSelected] = useState<AppointmentView | null>(null);
  const [creating, setCreating] = useState<{ start: Date; end: Date } | null>(null);

  useEffect(() => {
    if (searchParams.get('nueva') === '1') {
      const start = new Date();
      start.setMinutes(0, 0, 0);
      start.setHours(start.getHours() + 1);
      setCreating({ start, end: new Date(start.getTime() + 30 * 60000) });
    }
  }, [searchParams]);

  const canManage = !!user && ['asistente', 'medico', 'admin'].includes(user.rol);

  // Memorizado: si se crea inline en el render, RBC ve un componente nuevo cada vez,
  // remonta cada chip y el ResizeObserver que elige la variante vuelve a empezar de cero.
  const calendarComponents = useMemo(
    () => ({
      toolbar: CalendarToolbar,
      event: (props: { event: CalEvent }) => <AppointmentEvent {...props} formatoHora={formatoHora} />,
    }),
    [formatoHora],
  );

  const appointments = useQuery({
    queryKey: ['appointments', range.start.toISOString(), range.end.toISOString()],
    queryFn: () => api.listAppointments(token!, range.start.toISOString(), range.end.toISOString()),
    enabled: !!token,
  });

  const events: CalEvent[] = useMemo(
    () =>
      (appointments.data ?? []).map((a) => ({
        id: a.id,
        title: `${a.patientNombre}${a.motivo ? ' · ' + a.motivo : ''}`,
        start: new Date(a.inicioProgramado),
        end: new Date(a.finProgramado),
        resource: a,
      })),
    [appointments.data],
  );

  const cancel = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo?: string }) =>
      api.cancelAppointment(token!, id, { motivo }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      setSelected(null);
    },
    onError: (err) => alert(err instanceof ApiError ? err.message : 'Error al cancelar'),
  });

  const reschedule = useMutation({
    mutationFn: ({ id, doctorId, inicioProgramado, finProgramado }: { id: string; doctorId: string; inicioProgramado: string; finProgramado: string }) =>
      api.rescheduleAppointment(token!, id, { doctorId, inicioProgramado, finProgramado }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      setSelected(null);
    },
    onError: (err) => alert(err instanceof ApiError ? err.message : 'No se pudo reprogramar la cita'),
  });

  if (!user) return null;

  return (
    <AppShell>
      <div className="p-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Calendario</h1>
            <p className="text-sm text-slate-500">Consulta y agenda las citas de la clínica.</p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <ul className="flex flex-wrap items-center gap-3">
              {LEGEND_STATUSES.map((s) => (
                <li key={s} className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_HEX[s] }} />
                  {STATUS_LABEL[s]}
                </li>
              ))}
            </ul>
            {canManage && (
              <button
                onClick={() => setCreating({ start: roundHour(new Date()), end: new Date(roundHour(new Date()).getTime() + 30 * 60000) })}
                className="rounded-xl bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand-blue/20 transition hover:opacity-95"
              >
                + Nueva cita
              </button>
            )}
          </div>
        </div>

        <div className="hf-calendar rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <Calendar
            localizer={localizer}
            culture="es"
            formats={formats}
            messages={MESSAGES}
            events={events}
            view={view}
            onView={setView}
            views={['month', 'week', 'day', 'agenda']}
            defaultDate={new Date()}
            onRangeChange={(r) => setRange(normalizeRange(r, view))}
            min={HORARIO_MIN}
            max={HORARIO_MAX}
            style={{ height: CALENDAR_HEIGHT }}
            selectable={canManage}
            onSelectSlot={(slot: SlotInfo) => canManage && setCreating({ start: slot.start, end: slot.end })}
            onSelectEvent={(e: CalEvent) => setSelected(e.resource)}
            components={calendarComponents}
            eventPropGetter={(e: CalEvent) => {
              const color = STATUS_HEX[e.resource.estatus];
              const dimmed = e.resource.estatus === 'cancelada' || e.resource.estatus === 'no_asistio';
              return {
                style: {
                  backgroundColor: STATUS_TINT[e.resource.estatus],
                  borderLeft: `4px solid ${color}`,
                  borderRadius: 8,
                  opacity: dimmed ? 0.55 : 1,
                },
              };
            }}
          />
        </div>
      </div>

      {creating && (
        <NewAppointmentModal
          token={token!}
          initialStart={creating.start}
          initialEnd={creating.end}
          defaultDoctorId={user.rol === 'medico' ? user.id : undefined}
          onClose={() => {
            setCreating(null);
            if (searchParams.get('nueva') === '1') router.replace('/calendario');
          }}
          onCreated={() => {
            queryClient.invalidateQueries({ queryKey: ['appointments'] });
            setCreating(null);
            if (searchParams.get('nueva') === '1') router.replace('/calendario');
          }}
        />
      )}

      {selected && (
        <DetailModal
          appointment={selected}
          canCancel={canManage && selected.estatus === 'agendada'}
          canReschedule={canManage && selected.estatus === 'agendada'}
          cancelPending={cancel.isPending}
          reschedulePending={reschedule.isPending}
          token={token!}
          formatoHora={formatoHora}
          onCancel={(motivo) => cancel.mutate({ id: selected.id, motivo })}
          onReschedule={(doctorId, inicioProgramado, finProgramado) => reschedule.mutate({ id: selected.id, doctorId, inicioProgramado, finProgramado })}
          onClose={() => setSelected(null)}
        />
      )}
    </AppShell>
  );
}

/**
 * Mide el bloque que RBC posiciona. Devuelve el alto y ancho reales del chip,
 * que son los que deciden la variante: la duración en minutos no sirve porque
 * los mismos 30 min miden distinto según la vista y el alto del calendario.
 */
function useChipSize() {
  const ref = useRef<HTMLDivElement>(null);
  // enGrid arranca en true: en las vistas de rejilla evita que el primer frame
  // se pinte sin hora y luego dé un salto al medir.
  const [state, setState] = useState({ height: 0, width: 0, enGrid: true });

  const measure = useCallback((el: HTMLElement, enGrid: boolean) => {
    const { height, width } = el.getBoundingClientRect();
    setState((prev) =>
      prev.height === height && prev.width === width && prev.enGrid === enGrid
        ? prev
        : { height, width, enGrid },
    );
  }, []);

  useLayoutEffect(() => {
    // El chip vive dentro de .rbc-event-content; el bloque con el alto que RBC
    // calculó por duración es el .rbc-event de arriba, y es ese el que se mide.
    // En la vista Agenda no existe ese ancestro: allí la cita es una fila de tabla.
    const bloque = ref.current?.closest<HTMLElement>('.rbc-event');
    const objetivo = bloque ?? ref.current;
    if (!objetivo) return;
    measure(objetivo, !!bloque);
    const observer = new ResizeObserver(() => measure(objetivo, !!bloque));
    observer.observe(objetivo);
    return () => observer.disconnect();
  }, [measure]);

  return { ref, ...state };
}

// ── Chip de cita: jerarquía fija, altura mínima, variante por espacio ──
function AppointmentEvent({ event, formatoHora }: { event: CalEvent; formatoHora: FormatoHora }) {
  const a = event.resource;
  const color = STATUS_HEX[a.estatus];
  const dimmed = a.estatus === 'cancelada' || a.estatus === 'no_asistio';

  const { ref, height, width, enGrid } = useChipSize();
  // El alto solo decide cuántas líneas caben; el ancho, cuánto texto entra en ellas.
  const tresLineas = height >= CHIP_PX.alturaTresLineas;
  const nombreCompleto = width >= CHIP_PX.anchoNombreCompleto;
  const textClass = dimmed ? 'line-through' : '';

  const horaInicio = formatearHora(event.start.toISOString(), formatoHora);
  const horaFin = formatearHora(event.end.toISOString(), formatoHora);
  const nombreLinea = fitName(a.patientNombre, width);
  // El rango completo mide el doble que la hora sola: en Semana no cabe y se parte en dos líneas.
  const horaTexto = width >= CHIP_PX.anchoRangoHorario ? `${horaInicio} – ${horaFin}` : horaInicio;

  // Estatus: etiqueta de texto si sobra ancho, punto si no. En un chip muy
  // estrecho ni el punto — el riel de color ya lo dice y ese espacio lo necesita
  // el nombre, que es el dato que el usuario busca de un vistazo.
  const showLabel = STATUS_WITH_LABEL.includes(a.estatus) && width >= CHIP_PX.anchoEtiquetaEstatus;
  const estatusIndicador = showLabel ? (
    <span
      className="shrink-0 whitespace-nowrap rounded-full px-1.5 py-px text-[0.62rem] font-semibold leading-4"
      style={{ color, backgroundColor: 'rgb(255 255 255 / 0.75)' }}
    >
      {STATUS_LABEL[a.estatus]}
    </span>
  ) : width >= CHIP_PX.anchoNombreAbreviado ? (
    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
  ) : null;

  // En Agenda la hora ya la pone RBC en su propia columna; repetirla sobraría.
  const horaSpan = enGrid ? (
    <span
      className={`shrink-0 whitespace-nowrap text-[0.68rem] font-semibold tabular-nums ${textClass}`}
      style={{ color }}
    >
      {horaTexto}
    </span>
  ) : null;

  return (
    <div ref={ref} className="group relative h-full w-full">
      {tresLineas ? (
        // justify-start, no center: si el bloque se queda corto se recorta el motivo
        // (la línea menos importante) y nunca la hora ni el nombre.
        <div className="flex h-full flex-col justify-start gap-px leading-tight">
          <div className="flex items-center justify-between gap-1.5">
            {horaSpan}
            {estatusIndicador}
          </div>
          <span className={`truncate text-[0.8rem] font-semibold text-slate-900 ${textClass}`}>{nombreLinea}</span>
          {(a.motivo || a.doctorNombre) && (
            <span className={`truncate text-[0.68rem] text-slate-500 ${textClass}`}>
              {nombreCompleto ? [a.motivo, a.doctorNombre].filter(Boolean).join(' · ') : a.motivo || a.doctorNombre}
            </span>
          )}
        </div>
      ) : (
        // Una sola línea: hora, nombre y estatus. Nunca dos, porque a esta altura
        // la segunda quedaría recortada — que es justo lo que escondía el nombre.
        <div className="flex h-full items-center gap-1 overflow-hidden">
          {horaSpan}
          <span className={`min-w-0 flex-1 truncate text-[0.78rem] font-semibold text-slate-900 ${textClass}`}>
            {nombreLinea}
          </span>
          {estatusIndicador}
        </div>
      )}

      {/* Tarjeta flotante con detalle completo al pasar el cursor; no abre el modal. */}
      <div className="pointer-events-none invisible absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-3 text-xs opacity-0 shadow-lg transition-opacity duration-100 group-hover:visible group-hover:opacity-100">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-semibold text-slate-900">
            {horaInicio} – {horaFin}
          </span>
          <span className="rounded-full px-2 py-0.5 text-[0.65rem] font-semibold" style={{ color, backgroundColor: STATUS_TINT[a.estatus] }}>
            {STATUS_LABEL[a.estatus]}
          </span>
        </div>
        <p className="font-medium text-slate-800">{a.patientNombre}</p>
        {a.motivo && <p className="text-slate-500">{a.motivo}</p>}
        <p className="text-slate-400">{a.doctorNombre}</p>
      </div>
    </div>
  );
}

/**
 * Recorta el nombre al espacio disponible por palabras completas, nunca a media
 * palabra: "José Antonio Ramírez" pasa a "J. Ramírez" y, si sigue sin caber,
 * a "Ramírez" — que se lee, mientras que "José Anton…" no dice quién es.
 */
function fitName(nombre: string, ancho: number): string {
  const partes = nombre.trim().split(/\s+/);
  if (ancho >= CHIP_PX.anchoNombreCompleto || partes.length <= 1) return nombre;
  const apellido = partes[partes.length - 1]!;
  if (ancho < CHIP_PX.anchoNombreAbreviado) return apellido;
  return `${partes[0]![0]}. ${apellido}`;
}

// ── Toolbar del calendario ───────────────────────────────────────
function CalendarToolbar({ label, view, views, onNavigate, onView }: ToolbarProps<CalEvent, object>) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => onNavigate('TODAY')}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-brand-blue/40 hover:bg-brand-blue/5 hover:text-brand-blue"
        >
          Hoy
        </button>
        <div className="flex items-center overflow-hidden rounded-lg border border-slate-200">
          <button
            onClick={() => onNavigate('PREV')}
            aria-label="Anterior"
            className="px-2.5 py-2 text-slate-400 transition hover:bg-slate-50 hover:text-brand-blue"
          >
            ‹
          </button>
          <div className="h-5 w-px bg-slate-200" />
          <button
            onClick={() => onNavigate('NEXT')}
            aria-label="Siguiente"
            className="px-2.5 py-2 text-slate-400 transition hover:bg-slate-50 hover:text-brand-blue"
          >
            ›
          </button>
        </div>
        <h2 className="text-lg font-semibold capitalize text-slate-900">{label}</h2>
      </div>

      <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
        {(views as View[]).map((v) => (
          <button
            key={v}
            onClick={() => onView(v)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              view === v ? 'bg-white text-brand-blue shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {VIEW_LABELS[v]}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Modal: nueva cita ────────────────────────────────────────────
function NewAppointmentModal({
  token,
  initialStart,
  initialEnd,
  defaultDoctorId,
  onClose,
  onCreated,
}: {
  token: string;
  initialStart: Date;
  initialEnd: Date;
  defaultDoctorId?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [patientQuery, setPatientQuery] = useState('');
  const [patient, setPatient] = useState<PatientSummary | null>(null);
  const [doctorId, setDoctorId] = useState(defaultDoctorId ?? '');
  const [motivo, setMotivo] = useState('');
  const [start, setStart] = useState(toLocalInput(initialStart));
  const [end, setEnd] = useState(toLocalInput(initialEnd));
  const [error, setError] = useState<string | null>(null);

  const doctors = useQuery({ queryKey: ['doctors'], queryFn: () => api.listDoctors(token) });
  // Autocompletado: basta la primera página. Quien no vea a su paciente entre
  // los primeros afina la búsqueda, que es más rápido que paginar un desplegable.
  const patientResults = useQuery({
    queryKey: ['patients-search', patientQuery],
    queryFn: () => api.searchPatients(token, patientQuery, null, 10),
    enabled: patientQuery.trim().length >= 2,
    select: (page) => page.pacientes,
  });

  useEffect(() => {
    if (!doctorId && doctors.data && doctors.data.length > 0) setDoctorId(doctors.data[0].id);
  }, [doctors.data, doctorId]);

  const create = useMutation({
    mutationFn: () =>
      api.createAppointment(token, {
        patientId: patient!.id,
        doctorId,
        motivo: motivo.trim() || null,
        inicioProgramado: new Date(start).toISOString(),
        finProgramado: new Date(end).toISOString(),
      }),
    onSuccess: onCreated,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Error al agendar'),
  });

  return (
    <Modal titulo="Nueva cita" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-600">Paciente *</label>
          {patient ? (
            <div className="flex items-center justify-between rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <span>{patient.nombre}</span>
              <button onClick={() => setPatient(null)} className="text-xs text-slate-400 hover:text-slate-600">
                Cambiar
              </button>
            </div>
          ) : (
            <div className="relative">
              <input
                value={patientQuery}
                onChange={(e) => setPatientQuery(e.target.value)}
                placeholder="Buscar por nombre o CURP…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue"
              />
              {patientResults.data && patientResults.data.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                  {patientResults.data.map((p) => (
                    <li key={p.id}>
                      <button
                        onClick={() => {
                          setPatient(p);
                          setPatientQuery('');
                        }}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                      >
                        {p.nombre} <span className="text-xs text-slate-400">· {p.edad} años</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-600">Médico *</label>
          <select
            value={doctorId}
            onChange={(e) => setDoctorId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue"
          >
            {doctors.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nombre} {d.especialidad ? `· ${d.especialidad}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-600">Inicio *</span>
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-600">Fin *</span>
            <input
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue"
            />
          </label>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Motivo</span>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Opcional"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50">
            Cancelar
          </button>
          <button
            disabled={!patient || !doctorId || create.isPending}
            onClick={() => create.mutate()}
            className="rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-50"
          >
            {create.isPending ? 'Agendando…' : 'Agendar cita'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Modal: detalle / cancelar ────────────────────────────────────
function DetailModal({
  appointment,
  canCancel,
  canReschedule,
  cancelPending,
  reschedulePending,
  token,
  formatoHora,
  onCancel,
  onReschedule,
  onClose,
}: {
  appointment: AppointmentView;
  canCancel: boolean;
  canReschedule: boolean;
  cancelPending: boolean;
  reschedulePending: boolean;
  token: string;
  formatoHora: FormatoHora;
  onCancel: (motivo?: string) => void;
  onReschedule: (doctorId: string, inicioProgramado: string, finProgramado: string) => void;
  onClose: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [doctorId, setDoctorId] = useState(appointment.doctorId);
  const [start, setStart] = useState(toLocalInput(new Date(appointment.inicioProgramado)));
  const [end, setEnd] = useState(toLocalInput(new Date(appointment.finProgramado)));
  const doctors = useQuery({ queryKey: ['doctors'], queryFn: () => api.listDoctors(token), enabled: editing });

  const fechaHoraCita = (iso: string) =>
    `${new Date(iso).toLocaleDateString('es-MX')}, ${formatearHora(iso, formatoHora)}`;

  return (
    <Modal titulo="Detalle de la cita" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <Row label="Paciente" value={appointment.patientNombre} />
        <Row label="Médico" value={appointment.doctorNombre} />
        <Row label="Motivo" value={appointment.motivo ?? '—'} />
        <Row label="Inicio" value={fechaHoraCita(appointment.inicioProgramado)} />
        <Row label="Fin" value={fechaHoraCita(appointment.finProgramado)} />
        <Row label="Estatus" value={STATUS_LABEL[appointment.estatus]} />
        <Row label="Origen" value={appointment.origen === 'publico' ? 'Reserva pública' : 'Recepción'} />
        <Row label="Confirmación" value={appointment.estadoConfirmacion === 'confirmada' ? 'Confirmó asistencia' : appointment.estadoConfirmacion === 'cancelada' ? 'Cancelada' : 'Pendiente'} />
        {appointment.posibleDuplicado && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
            Posible paciente duplicado: revisa la ficha antes de combinar expedientes.
          </div>
        )}

        {canCancel && !confirming && (
          <button
            onClick={() => setConfirming(true)}
            className="mt-2 w-full rounded-lg border border-red-300 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
          >
            Cancelar cita
          </button>
        )}

        {canReschedule && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="mt-2 w-full rounded-lg border border-blue-300 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
          >
            Cambiar fecha u hora
          </button>
        )}

        {canReschedule && editing && (
          <div className="mt-2 space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
            <p className="text-sm font-semibold text-blue-900">Reprogramar cita</p>
            <label className="block text-xs font-medium text-blue-800">Médico
              <select value={doctorId} onChange={(event) => setDoctorId(event.target.value)} className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-slate-900">
                {doctors.data?.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.nombre}{doctor.especialidad ? ` · ${doctor.especialidad}` : ''}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-medium text-blue-800">Inicio<input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-2 py-2 text-sm text-slate-900" /></label>
              <label className="text-xs font-medium text-blue-800">Fin<input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-2 py-2 text-sm text-slate-900" /></label>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(false)} disabled={reschedulePending} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-white">Cancelar</button>
              <button disabled={!doctorId || !start || !end || reschedulePending} onClick={() => onReschedule(doctorId, new Date(start).toISOString(), new Date(end).toISOString())} className="rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50">{reschedulePending ? 'Guardando…' : 'Guardar nuevo horario'}</button>
            </div>
          </div>
        )}

        {canCancel && confirming && (
          <div className="mt-2 space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
            <label className="block text-xs font-medium text-red-700">Motivo de cancelación (opcional)</label>
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="w-full rounded-lg border border-red-300 px-3 py-2 text-sm outline-none"
              placeholder="Ej. paciente reagendó por teléfono"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirming(false)} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
                Volver
              </button>
              <button
                disabled={cancelPending}
                onClick={() => onCancel(motivo.trim() || undefined)}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {cancelPending ? 'Cancelando…' : 'Confirmar cancelación'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-slate-100 pb-2">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Modal({ titulo, onClose, children }: { titulo: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{titulo}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────
function weekRange(d: Date): { start: Date; end: Date } {
  const start = startOfWeek(d, { locale: es });
  const end = new Date(start.getTime() + 7 * 24 * 3600 * 1000);
  return { start, end };
}

function normalizeRange(
  r: Date[] | { start: Date; end: Date },
  view: View,
): { start: Date; end: Date } {
  if (Array.isArray(r)) {
    return { start: r[0]!, end: new Date(r[r.length - 1]!.getTime() + 24 * 3600 * 1000) };
  }
  if (view === 'month') {
    // RBC entrega el rango visible del grid (incluye días de meses vecinos); suficiente para prefetch.
    return { start: r.start, end: r.end };
  }
  return { start: r.start, end: r.end };
}

function roundHour(d: Date): Date {
  const r = new Date(d);
  r.setMinutes(0, 0, 0);
  r.setHours(r.getHours() + 1);
  return r;
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
