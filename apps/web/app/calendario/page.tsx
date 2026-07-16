'use client';

import 'react-big-calendar/lib/css/react-big-calendar.css';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Calendar,
  dateFnsLocalizer,
  type SlotInfo,
  type View,
} from 'react-big-calendar';
import { format, getDay, parse, startOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import type { AppointmentView, PatientSummary } from '@healthflow/shared-types';
import { useAuth } from '../../lib/auth';
import { api, ApiError } from '../../lib/api';
import { AppShell } from '../../components/app-shell';
import { STATUS_HEX, STATUS_LABEL } from '../../components/status-badge';

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

  if (!user) return null;

  return (
    <AppShell>
      <div className="p-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Calendario</h1>
          {canManage && (
            <button
              onClick={() => setCreating({ start: roundHour(new Date()), end: new Date(roundHour(new Date()).getTime() + 30 * 60000) })}
              className="rounded-xl bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-95"
            >
              + Nueva cita
            </button>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <Calendar
            localizer={localizer}
            culture="es"
            messages={MESSAGES}
            events={events}
            view={view}
            onView={setView}
            views={['month', 'week', 'day', 'agenda']}
            defaultDate={new Date()}
            onRangeChange={(r) => setRange(normalizeRange(r, view))}
            style={{ height: 680 }}
            selectable={canManage}
            onSelectSlot={(slot: SlotInfo) => canManage && setCreating({ start: slot.start, end: slot.end })}
            onSelectEvent={(e: CalEvent) => setSelected(e.resource)}
            eventPropGetter={(e: CalEvent) => ({
              style: {
                backgroundColor: STATUS_HEX[e.resource.estatus],
                border: 'none',
                borderRadius: 6,
                opacity: e.resource.estatus === 'cancelada' || e.resource.estatus === 'no_asistio' ? 0.5 : 1,
              },
            })}
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
          pending={cancel.isPending}
          onCancel={(motivo) => cancel.mutate({ id: selected.id, motivo })}
          onClose={() => setSelected(null)}
        />
      )}
    </AppShell>
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
  const patientResults = useQuery({
    queryKey: ['patients-search', patientQuery],
    queryFn: () => api.searchPatients(token, patientQuery),
    enabled: patientQuery.trim().length >= 2,
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
  pending,
  onCancel,
  onClose,
}: {
  appointment: AppointmentView;
  canCancel: boolean;
  pending: boolean;
  onCancel: (motivo?: string) => void;
  onClose: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [confirming, setConfirming] = useState(false);

  return (
    <Modal titulo="Detalle de la cita" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <Row label="Paciente" value={appointment.patientNombre} />
        <Row label="Médico" value={appointment.doctorNombre} />
        <Row label="Motivo" value={appointment.motivo ?? '—'} />
        <Row label="Inicio" value={new Date(appointment.inicioProgramado).toLocaleString('es-MX')} />
        <Row label="Fin" value={new Date(appointment.finProgramado).toLocaleString('es-MX')} />
        <Row label="Estatus" value={STATUS_LABEL[appointment.estatus]} />

        {canCancel && !confirming && (
          <button
            onClick={() => setConfirming(true)}
            className="mt-2 w-full rounded-lg border border-red-300 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
          >
            Cancelar cita
          </button>
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
                disabled={pending}
                onClick={() => onCancel(motivo.trim() || undefined)}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {pending ? 'Cancelando…' : 'Confirmar cancelación'}
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
