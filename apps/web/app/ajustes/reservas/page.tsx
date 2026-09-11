'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  BookingMetrics,
  BookingReadiness,
  BookingService,
  BookingSettings,
  DoctorSummary,
  MessagingDelivery,
} from '@healthflow/shared-types';
import { AppShell } from '../../../components/app-shell';
import { useAuth } from '../../../lib/auth';
import { api, ApiError } from '../../../lib/api';

type AvailabilityRule = {
  doctor_id: string;
  weekday: number;
  inicio_local: string;
  fin_local: string;
};
type DaySchedule = { enabled: boolean; from: string; to: string };
type WeekSchedule = Record<number, DaySchedule>;

const DAYS = [
  { value: 1, short: 'Lun', label: 'Lunes' },
  { value: 2, short: 'Mar', label: 'Martes' },
  { value: 3, short: 'Mié', label: 'Miércoles' },
  { value: 4, short: 'Jue', label: 'Jueves' },
  { value: 5, short: 'Vie', label: 'Viernes' },
  { value: 6, short: 'Sáb', label: 'Sábado' },
  { value: 0, short: 'Dom', label: 'Domingo' },
];
const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:ring-4 focus:ring-blue-100';
const primaryButton = 'inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-45';
const secondaryButton = 'inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-45';

export default function BookingSettingsPage() {
  const { token, user, ready } = useAuth();
  const router = useRouter();
  const [settings, setSettings] = useState<BookingSettings | null>(null);
  const [services, setServices] = useState<BookingService[]>([]);
  const [doctors, setDoctors] = useState<DoctorSummary[]>([]);
  const [deliveries, setDeliveries] = useState<MessagingDelivery[]>([]);
  const [metrics, setMetrics] = useState<BookingMetrics | null>(null);
  const [readiness, setReadiness] = useState<BookingReadiness | null>(null);
  const [availabilityRules, setAvailabilityRules] = useState<AvailabilityRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const [name, setName] = useState('');
  const [duration, setDuration] = useState(60);
  const [price, setPrice] = useState('');
  const [selectedDoctors, setSelectedDoctors] = useState<string[]>([]);
  const [scheduleDoctor, setScheduleDoctor] = useState('');
  const [weekSchedule, setWeekSchedule] = useState<WeekSchedule>(() => defaultWeekSchedule());
  const [exceptionDate, setExceptionDate] = useState('');
  const [exceptionNote, setExceptionNote] = useState('');

  useEffect(() => {
    if (ready && !token) router.replace('/login');
    if (!token || user?.rol !== 'admin') return;
    let active = true;
    Promise.all([
      api.bookingSettings(token),
      api.bookingServices(token),
      api.listDoctors(token),
      api.messagingDeliveries(token),
      api.bookingMetrics(token),
      api.bookingReadiness(token),
      api.bookingAvailabilityRules(token),
    ]).then(([nextSettings, nextServices, nextDoctors, nextDeliveries, nextMetrics, nextReadiness, nextRules]) => {
      if (!active) return;
      setSettings(nextSettings);
      setServices(nextServices);
      setDoctors(nextDoctors);
      setDeliveries(nextDeliveries);
      setMetrics(nextMetrics);
      setReadiness(nextReadiness);
      setAvailabilityRules(nextRules);
      setScheduleDoctor(nextDoctors[0]?.id ?? '');
    }).catch((caught) => active && setError(messageFrom(caught, 'No se pudieron cargar los ajustes de reservas.')))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [ready, token, user, router]);

  useEffect(() => {
    if (!scheduleDoctor) return;
    const doctorRules = availabilityRules.filter((rule) => rule.doctor_id === scheduleDoctor);
    setWeekSchedule(scheduleFromRules(doctorRules));
  }, [scheduleDoctor, availabilityRules]);

  const bookingPath = settings ? `/reservar/${settings.slug}` : '';
  const activeServices = services.filter((service) => service.activo);
  const visibleServices = activeServices.filter((service) => service.publico);
  const doctorNameById = useMemo(() => new Map(doctors.map((doctor) => [doctor.id, doctor.nombre])), [doctors]);

  function beginAction(action: string) {
    setBusy(action);
    setError('');
    setSaved('');
  }
  function finishAction() { setBusy(''); }

  async function refreshReadiness() {
    if (token) setReadiness(await api.bookingReadiness(token));
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    if (!settings || !token) return;
    beginAction('settings');
    try {
      const payload = { ...settings, featureActiva: settings.publicado || settings.featureActiva };
      setSettings(await api.updateBookingSettings(token, payload));
      await refreshReadiness();
      setSaved('La configuración de reservas quedó guardada.');
    } catch (caught) {
      setError(messageFrom(caught, 'No se pudo guardar la configuración.'));
    } finally { finishAction(); }
  }

  async function copyBookingLink() {
    if (!bookingPath) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${bookingPath}`);
      setSaved('Enlace de reservas copiado.');
    } catch {
      setError('No pudimos copiar el enlace. Puedes abrirlo y copiarlo desde el navegador.');
    }
  }

  async function addService(event: React.FormEvent) {
    event.preventDefault();
    if (!token) return;
    if (!selectedDoctors.length) {
      setError('Selecciona al menos un profesional que atienda este servicio.');
      return;
    }
    beginAction('service');
    try {
      const created = await api.createBookingService(token, {
        nombre: name,
        duracionMinutos: duration,
        precioCentavos: price ? Math.round(Number(price) * 100) : null,
        publico: true,
        activo: true,
        orden: services.length,
        doctorIds: selectedDoctors,
      });
      setServices((current) => [...current, created]);
      setName(''); setPrice(''); setSelectedDoctors([]);
      await refreshReadiness();
      setSaved(`«${created.nombre}» ya está disponible para reservar.`);
    } catch (caught) {
      setError(messageFrom(caught, 'No se pudo crear el servicio.'));
    } finally { finishAction(); }
  }

  async function changeService(service: BookingService, changes: Partial<Pick<BookingService, 'publico' | 'activo'>>) {
    if (!token) return;
    beginAction(`service-${service.id}`);
    try {
      const { id, ...body } = service;
      const updated = await api.updateBookingService(token, id, { ...body, ...changes });
      setServices((current) => current.map((item) => item.id === id ? updated : item));
      await refreshReadiness();
      setSaved(`«${service.nombre}» se actualizó.`);
    } catch (caught) {
      setError(messageFrom(caught, 'No se pudo actualizar el servicio.'));
    } finally { finishAction(); }
  }

  async function deactivateService(service: BookingService) {
    if (!token || !confirm(`¿Dar de baja «${service.nombre}»?\n\nYa no aparecerá para nuevas reservas. Las citas existentes se conservarán.`)) return;
    beginAction(`service-${service.id}`);
    try {
      const updated = await api.deleteBookingService(token, service.id);
      setServices((current) => current.map((item) => item.id === service.id ? updated : item));
      await refreshReadiness();
      setSaved(`«${service.nombre}» se dio de baja.`);
    } catch (caught) {
      setError(messageFrom(caught, 'No se pudo dar de baja el servicio.'));
    } finally { finishAction(); }
  }

  async function saveSchedule() {
    if (!token || !scheduleDoctor) return;
    const enabledDays = DAYS.filter((day) => weekSchedule[day.value]?.enabled);
    if (!enabledDays.length) {
      setError('Activa por lo menos un día de atención.');
      return;
    }
    if (enabledDays.some((day) => weekSchedule[day.value]!.from >= weekSchedule[day.value]!.to)) {
      setError('La hora de salida debe ser posterior a la hora de inicio.');
      return;
    }
    beginAction('schedule');
    try {
      const rules = enabledDays.map((day) => ({
        weekday: day.value,
        inicioLocal: weekSchedule[day.value]!.from,
        finLocal: weekSchedule[day.value]!.to,
      }));
      await api.replaceBookingAvailability(token, scheduleDoctor, rules);
      setAvailabilityRules((current) => [
        ...current.filter((rule) => rule.doctor_id !== scheduleDoctor),
        ...rules.map((rule) => ({ doctor_id: scheduleDoctor, weekday: rule.weekday, inicio_local: rule.inicioLocal, fin_local: rule.finLocal })),
      ]);
      setSaved(`Horario de ${doctorNameById.get(scheduleDoctor) ?? 'profesional'} guardado.`);
    } catch (caught) {
      setError(messageFrom(caught, 'No se pudo guardar el horario.'));
    } finally { finishAction(); }
  }

  function copyMondayToWeekdays() {
    const monday = weekSchedule[1] ?? { enabled: true, from: '09:00', to: '18:00' };
    setWeekSchedule((current) => ({
      ...current,
      1: { ...monday, enabled: true },
      2: { ...monday, enabled: true },
      3: { ...monday, enabled: true },
      4: { ...monday, enabled: true },
      5: { ...monday, enabled: true },
    }));
  }

  async function blockDay() {
    if (!token || !scheduleDoctor || !exceptionDate) return;
    beginAction('exception');
    try {
      await api.createBookingException(token, {
        doctorId: scheduleDoctor,
        fecha: exceptionDate,
        disponible: false,
        nota: exceptionNote.trim() || 'Día no disponible',
      });
      setExceptionDate(''); setExceptionNote('');
      setSaved('El día quedó bloqueado para nuevas reservas.');
    } catch (caught) {
      setError(messageFrom(caught, 'No se pudo bloquear el día.'));
    } finally { finishAction(); }
  }

  async function retryDelivery(deliveryId: string, confirmResend = false) {
    if (!token) return;
    if (confirmResend && !window.confirm('Este mensaje pudo haberse enviado. Si lo reenvías y sí llegó, el paciente lo recibirá dos veces. ¿Verificaste en el proveedor que no salió?')) return;
    beginAction(`delivery-${deliveryId}`);
    try {
      await api.retryDelivery(token, deliveryId, confirmResend);
      setDeliveries(await api.messagingDeliveries(token));
      setSaved('El mensaje se programó para enviarse nuevamente.');
    } catch (caught) {
      setError(messageFrom(caught, 'No se pudo reenviar el mensaje.'));
    } finally { finishAction(); }
  }

  async function markDeliverySent(deliveryId: string) {
    if (!token) return;
    beginAction(`delivery-${deliveryId}`);
    try {
      await api.markDeliverySent(token, deliveryId);
      setDeliveries(await api.messagingDeliveries(token));
      setSaved('El mensaje quedó registrado como enviado.');
    } catch (caught) {
      setError(messageFrom(caught, 'No se pudo actualizar el mensaje.'));
    } finally { finishAction(); }
  }

  if (!ready || !token || !user) return null;
  if (user.rol !== 'admin') return <AppShell><EmptyAccess/></AppShell>;

  return <AppShell>
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <button onClick={() => router.push('/ajustes')} className="text-sm font-medium text-blue-700 hover:underline">← Volver a ajustes</button>
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.14em] text-blue-700">Agenda en línea</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Reservas</h1>
          <p className="mt-1 text-slate-600">Define qué pueden reservar tus pacientes y cuándo pueden hacerlo.</p>
        </div>
        {settings && <div className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ${isBookingReady(readiness) ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
          <span className={`h-2 w-2 rounded-full ${isBookingReady(readiness) ? 'bg-emerald-500' : 'bg-amber-500'}`}/>
          {isBookingReady(readiness) ? 'Agenda visible para pacientes' : 'Configuración pendiente'}
        </div>}
      </header>

      {error && <Notice tone="error" onClose={() => setError('')}>{error}</Notice>}
      {saved && <Notice tone="success" onClose={() => setSaved('')}>{saved}</Notice>}

      {loading ? <PageSkeleton/> : <>
        {settings && <PublicationCard
          settings={settings}
          readiness={readiness}
          bookingPath={bookingPath}
          busy={busy === 'settings'}
          onSettingsChange={setSettings}
          onSave={saveSettings}
          onCopy={copyBookingLink}
        />}

        {metrics && <MetricsPanel metrics={metrics}/>}

        <nav className="grid gap-3 sm:grid-cols-3" aria-label="Secciones de reservas">
          <SectionLink href="#servicios" number="1" title="Servicios" description={`${visibleServices.length} disponibles en línea`}/>
          <SectionLink href="#horarios" number="2" title="Horarios" description="Disponibilidad por profesional"/>
          <SectionLink href="#mensajes" number="3" title="Mensajes" description="Confirmaciones y recordatorios"/>
        </nav>

        <section id="servicios" className="scroll-mt-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <SectionHeader number="1" title="Servicios que pueden reservar" description="Administra primero el catálogo visible para tus pacientes."/>
          <div className="mt-5 space-y-3">
            {services.length ? services.map((service) => <ServiceRow
              key={service.id}
              service={service}
              doctorNames={service.doctorIds.map((id) => doctorNameById.get(id)).filter(Boolean) as string[]}
              busy={busy === `service-${service.id}`}
              onChange={changeService}
              onDeactivate={deactivateService}
            />) : <EmptyState title="Aún no tienes servicios" description="Agrega el primer servicio que tus pacientes podrán reservar."/>}
          </div>

          <details className="group mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 open:border-blue-200 open:bg-blue-50/40">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-blue-700">＋ Agregar un servicio</summary>
            <form onSubmit={addService} className="border-t border-slate-200 p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nombre del servicio" className="sm:col-span-2"><input className={inputClass} required minLength={2} placeholder="Ej. Consulta de valoración" value={name} onChange={(event) => setName(event.target.value)}/></Field>
                <Field label="Duración"><div className="relative"><input className={`${inputClass} pr-14`} required type="number" min={10} max={480} value={duration} onChange={(event) => setDuration(Number(event.target.value))}/><span className="pointer-events-none absolute bottom-2.5 right-3 text-sm text-slate-500">min</span></div></Field>
                <Field label="Precio informativo (opcional)"><div className="relative"><span className="pointer-events-none absolute bottom-2.5 left-3.5 text-sm text-slate-500">$</span><input className={`${inputClass} pl-7`} type="number" min={0} step="0.01" placeholder="0.00" value={price} onChange={(event) => setPrice(event.target.value)}/></div></Field>
              </div>
              <fieldset className="mt-4"><legend className="text-sm font-medium text-slate-700">¿Quién atiende este servicio?</legend><div className="mt-2 flex flex-wrap gap-2">{doctors.map((doctor) => <ToggleChoice key={doctor.id} checked={selectedDoctors.includes(doctor.id)} label={doctor.nombre} onChange={(checked) => setSelectedDoctors(checked ? [...selectedDoctors, doctor.id] : selectedDoctors.filter((id) => id !== doctor.id))}/>)}</div></fieldset>
              <button className={`${primaryButton} mt-5`} disabled={busy === 'service'}>{busy === 'service' ? 'Agregando…' : 'Agregar y publicar servicio'}</button>
            </form>
          </details>
        </section>

        <section id="horarios" className="scroll-mt-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <SectionHeader number="2" title="Horarios de atención" description="Elige un profesional y marca los días que acepta reservas en línea."/>
          {doctors.length ? <>
            <Field label="Profesional" className="mt-5 max-w-md"><select className={inputClass} value={scheduleDoctor} onChange={(event) => setScheduleDoctor(event.target.value)}>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.nombre}{doctor.especialidad ? ` · ${doctor.especialidad}` : ''}</option>)}</select></Field>
            <div className="mt-5 flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-slate-800">Semana habitual</p><p className="text-xs text-slate-500">Desactiva los días en los que no atiende.</p></div><button type="button" className={secondaryButton} onClick={copyMondayToWeekdays}>Aplicar lunes a viernes</button></div>
            <div className="divide-y divide-slate-100">
              {DAYS.map((day) => {
                const current = weekSchedule[day.value] ?? { enabled: false, from: '09:00', to: '18:00' };
                return <div key={day.value} className="grid gap-3 py-3 sm:grid-cols-[150px_1fr] sm:items-center">
                  <label className="flex cursor-pointer items-center gap-3"><input className="h-4 w-4 rounded border-slate-300 text-blue-600" type="checkbox" checked={current.enabled} onChange={(event) => setWeekSchedule((week) => ({ ...week, [day.value]: { ...current, enabled: event.target.checked } }))}/><span className={`text-sm font-semibold ${current.enabled ? 'text-slate-800' : 'text-slate-400'}`}>{day.label}</span></label>
                  {current.enabled ? <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2"><input aria-label={`Inicio ${day.label}`} className={inputClass.replace('mt-1.5 ', '')} type="time" value={current.from} onChange={(event) => setWeekSchedule((week) => ({ ...week, [day.value]: { ...current, from: event.target.value } }))}/><span className="text-xs text-slate-400">a</span><input aria-label={`Fin ${day.label}`} className={inputClass.replace('mt-1.5 ', '')} type="time" value={current.to} onChange={(event) => setWeekSchedule((week) => ({ ...week, [day.value]: { ...current, to: event.target.value } }))}/></div> : <p className="text-sm text-slate-400">No disponible para reservas</p>}
                </div>;
              })}
            </div>
            <button type="button" className={`${primaryButton} mt-4`} disabled={busy === 'schedule'} onClick={saveSchedule}>{busy === 'schedule' ? 'Guardando…' : 'Guardar horario semanal'}</button>

            <div className="mt-8 rounded-2xl bg-amber-50 p-4 sm:p-5">
              <div className="flex gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700"><CalendarOffIcon/></span><div><h3 className="font-semibold text-slate-900">Bloquear una ausencia</h3><p className="mt-0.5 text-sm text-slate-600">Para vacaciones, congresos, festivos o asuntos personales.</p></div></div>
              <div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr_auto]"><input aria-label="Fecha que se bloqueará" className={inputClass.replace('mt-1.5 ', '')} type="date" min={todayInputValue()} value={exceptionDate} onChange={(event) => setExceptionDate(event.target.value)}/><input aria-label="Motivo opcional" className={inputClass.replace('mt-1.5 ', '')} placeholder="Motivo opcional" maxLength={160} value={exceptionNote} onChange={(event) => setExceptionNote(event.target.value)}/><button type="button" disabled={!scheduleDoctor || !exceptionDate || busy === 'exception'} className={secondaryButton} onClick={blockDay}>{busy === 'exception' ? 'Bloqueando…' : 'Bloquear día'}</button></div>
            </div>
          </> : <EmptyState title="No hay profesionales disponibles" description="Agrega o activa un médico antes de configurar horarios."/>}
        </section>

        <section id="mensajes" className="scroll-mt-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <SectionHeader number="3" title="Confirmaciones y recordatorios" description="Revisa únicamente los mensajes que requieren atención."/>
          <DeliveryPanel deliveries={deliveries} busy={busy} onRetry={retryDelivery} onMarkSent={markDeliverySent}/>
        </section>
      </>}
    </main>
  </AppShell>;
}

function PublicationCard({ settings, readiness, bookingPath, busy, onSettingsChange, onSave, onCopy }: {
  settings: BookingSettings;
  readiness: BookingReadiness | null;
  bookingPath: string;
  busy: boolean;
  onSettingsChange: (settings: BookingSettings) => void;
  onSave: (event: React.FormEvent) => void;
  onCopy: () => void;
}) {
  const missing = readinessMissing(readiness);
  return <form onSubmit={onSave} className={`overflow-hidden rounded-2xl border ${isBookingReady(readiness) ? 'border-emerald-200 bg-emerald-50/40' : 'border-amber-200 bg-amber-50/40'}`}>
    <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-start">
      <div>
        <div className="flex items-start gap-3"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${isBookingReady(readiness) ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}><GlobeIcon/></span><div><h2 className="text-lg font-bold text-slate-950">Tu página de reservas</h2><p className="mt-1 text-sm text-slate-600">{isBookingReady(readiness) ? 'Los pacientes ya pueden consultar horarios y reservar.' : 'Completa lo pendiente para comenzar a recibir reservas.'}</p></div></div>
        {missing.length > 0 && <ul className="mt-4 space-y-1.5 pl-13 text-sm text-amber-900">{missing.map((item) => <li key={item} className="flex gap-2"><span aria-hidden>○</span><span>{item}</span></li>)}</ul>}
      </div>
      <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-white/80 bg-white px-4 py-3 shadow-sm"><span><span className="block text-sm font-semibold text-slate-900">Aceptar reservas en línea</span><span className="block text-xs text-slate-500">Puedes pausarlas cuando quieras</span></span><Switch checked={settings.publicado} onChange={(checked) => onSettingsChange({ ...settings, publicado: checked, featureActiva: checked || settings.featureActiva })}/></label>
    </div>
    <div className="border-t border-slate-200/80 bg-white p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Enlace para tus pacientes</p><p className="mt-1 truncate text-sm font-medium text-slate-800">{bookingPath}</p></div><div className="flex gap-2"><a className={secondaryButton} href={bookingPath} target="_blank" rel="noreferrer">Vista del paciente ↗</a><button type="button" className={secondaryButton} onClick={onCopy}>Copiar enlace</button></div></div>
      <label className="mt-5 flex cursor-pointer items-start justify-between gap-4 rounded-xl bg-slate-50 p-4"><span><span className="block text-sm font-semibold text-slate-900">Aparecer en el directorio de HealthFlow</span><span className="mt-0.5 block text-xs leading-relaxed text-slate-500">Publica el nombre y dirección de la clínica, además de los nombres y especialidades de sus médicos.</span></span><Switch checked={settings.directorioPublico} onChange={(checked) => onSettingsChange({ ...settings, directorioPublico: checked })}/></label>

      <details className="group mt-5"><summary className="cursor-pointer text-sm font-semibold text-slate-600 hover:text-blue-700">Configuración de anticipación y cancelación</summary><div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4"><Field label="Reservar con anticipación"><NumberWithSuffix value={settings.anticipacionMinimaHoras} suffix="horas" min={0} max={720} onChange={(value) => onSettingsChange({ ...settings, anticipacionMinimaHoras: value })}/></Field><Field label="Agenda visible por"><NumberWithSuffix value={settings.horizonteDias} suffix="días" min={1} max={365} onChange={(value) => onSettingsChange({ ...settings, horizonteDias: value })}/></Field><Field label="Cancelar hasta antes de"><NumberWithSuffix value={settings.limiteCancelacionHoras} suffix="horas" min={0} max={720} onChange={(value) => onSettingsChange({ ...settings, limiteCancelacionHoras: value })}/></Field><Field label="Enviar recordatorios"><input className={inputClass} value={settings.recordatoriosHoras.join(', ')} onChange={(event) => onSettingsChange({ ...settings, recordatoriosHoras: event.target.value.split(',').map(Number).filter((value) => Number.isInteger(value) && value >= 0) })}/><span className="mt-1 block text-xs text-slate-500">Horas antes, por ejemplo: 48, 24</span></Field></div><details className="mt-4 rounded-xl bg-slate-50 p-4"><summary className="cursor-pointer text-xs font-semibold text-slate-500">Datos técnicos avanzados</summary><div className="mt-3 grid gap-4 md:grid-cols-2"><Field label="Dirección del enlace (slug)"><input className={inputClass} value={settings.slug} onChange={(event) => onSettingsChange({ ...settings, slug: event.target.value.toLowerCase() })}/></Field><Field label="Zona horaria"><input className={inputClass} value={settings.timezone} onChange={(event) => onSettingsChange({ ...settings, timezone: event.target.value })}/></Field></div></details></details>
      <button className={`${primaryButton} mt-5`} disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
    </div>
  </form>;
}

function MetricsPanel({ metrics }: { metrics: BookingMetrics }) {
  const items = [
    { label: 'Reservas en línea', value: metrics.publicBookings, tone: 'text-blue-700' },
    { label: 'Confirmadas', value: metrics.confirmed, tone: 'text-emerald-700' },
    { label: 'Reprogramadas', value: metrics.rescheduled, tone: 'text-violet-700' },
    { label: 'Canceladas', value: metrics.cancelled, tone: 'text-slate-700' },
    { label: 'No asistieron', value: metrics.noShows, tone: metrics.noShows ? 'text-amber-700' : 'text-slate-700' },
  ];
  return <section><div className="mb-3 flex items-end justify-between"><div><h2 className="font-bold text-slate-900">Actividad reciente</h2><p className="text-sm text-slate-500">Resumen de las reservas recibidas en línea.</p></div><p className="hidden text-xs text-slate-400 sm:block">{metrics.delivered} mensajes entregados</p></div><div className="grid grid-cols-2 gap-3 md:grid-cols-5">{items.map((item) => <div key={item.label} className="rounded-xl border border-slate-200 bg-white p-4"><p className={`text-2xl font-bold ${item.tone}`}>{item.value}</p><p className="mt-1 text-xs font-medium text-slate-500">{item.label}</p></div>)}</div></section>;
}

function ServiceRow({ service, doctorNames, busy, onChange, onDeactivate }: { service: BookingService; doctorNames: string[]; busy: boolean; onChange: (service: BookingService, changes: Partial<Pick<BookingService, 'publico' | 'activo'>>) => void; onDeactivate: (service: BookingService) => void }) {
  const status = !service.activo ? { text: 'Dado de baja', className: 'bg-slate-100 text-slate-600' } : service.publico ? { text: 'Disponible en línea', className: 'bg-emerald-100 text-emerald-800' } : { text: 'Pausado', className: 'bg-amber-100 text-amber-800' };
  return <article className="rounded-xl border border-slate-200 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h3 className={`font-bold ${service.activo ? 'text-slate-900' : 'text-slate-500 line-through'}`}>{service.nombre}</h3><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status.className}`}>{status.text}</span></div><p className="mt-1 text-sm text-slate-500">{service.duracionMinutos} min{service.precioCentavos != null ? ` · ${formatPrice(service.precioCentavos)}` : ''}</p><p className="mt-1 text-xs text-slate-500">{doctorNames.length ? `Atiende: ${doctorNames.join(', ')}` : 'Sin profesionales asignados'}</p></div><div className="flex shrink-0 flex-wrap gap-2">{!service.activo ? <button type="button" disabled={busy} className={secondaryButton} onClick={() => onChange(service, { activo: true, publico: false })}>Reactivar</button> : <><button type="button" disabled={busy} className={secondaryButton} onClick={() => onChange(service, { publico: !service.publico })}>{service.publico ? 'Pausar reservas' : 'Publicar'}</button><button type="button" disabled={busy} className="min-h-10 px-2 text-sm font-semibold text-red-700 hover:underline" onClick={() => onDeactivate(service)}>Dar de baja</button></>}</div></div></article>;
}

function DeliveryPanel({ deliveries, busy, onRetry, onMarkSent }: { deliveries: MessagingDelivery[]; busy: string; onRetry: (id: string, confirmResend?: boolean) => void; onMarkSent: (id: string) => void }) {
  const failed = deliveries.filter((delivery) => ['failed', 'dead'].includes(delivery.status));
  const uncertain = deliveries.filter((delivery) => delivery.status === 'uncertain');
  if (!failed.length && !uncertain.length) return <div className="mt-5 flex items-start gap-3 rounded-xl bg-emerald-50 p-4"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-100 font-bold text-emerald-700">✓</span><div><p className="text-sm font-semibold text-emerald-900">Los mensajes están al corriente</p><p className="mt-0.5 text-xs text-emerald-800">No hay confirmaciones ni recordatorios pendientes de revisión.</p></div></div>;
  return <div className="mt-5 space-y-3">
    {uncertain.map((delivery) => <div key={delivery.id} className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-amber-900">No sabemos si se entregó {deliveryLabel(delivery.kind).toLowerCase()} por {channelLabel(delivery.channel)}</p><p className="mt-1 text-xs text-amber-800">El proveedor no respondió a tiempo. Revisa en {delivery.channel === 'whatsapp' ? 'Twilio' : 'Resend'} si salió antes de decidir; reenviar sin revisar puede duplicar el mensaje al paciente.</p></div><div className="flex shrink-0 gap-2"><button type="button" className={secondaryButton} disabled={busy === `delivery-${delivery.id}`} onClick={() => onMarkSent(delivery.id)}>Sí se envió</button><button type="button" className={secondaryButton} disabled={busy === `delivery-${delivery.id}`} onClick={() => onRetry(delivery.id, true)}>{busy === `delivery-${delivery.id}` ? 'Procesando…' : 'No salió, reenviar'}</button></div></div>)}
    {failed.map((delivery) => <div key={delivery.id} className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-red-900">No se entregó {deliveryLabel(delivery.kind).toLowerCase()} por {channelLabel(delivery.channel)}</p><p className="mt-1 text-xs text-red-700">Se intentó {delivery.attempts} {delivery.attempts === 1 ? 'vez' : 'veces'}.{delivery.status === 'dead' ? ' El proveedor rechazó el destino o se agotaron los reintentos.' : ''}</p></div><button type="button" className={secondaryButton} disabled={busy === `delivery-${delivery.id}`} onClick={() => onRetry(delivery.id)}>{busy === `delivery-${delivery.id}` ? 'Reenviando…' : 'Reintentar envío'}</button></div>)}
  </div>;
}
function channelLabel(channel: MessagingDelivery['channel']) { return channel === 'whatsapp' ? 'WhatsApp' : 'correo'; }

function SectionLink({ href, number, title, description }: { href: string; number: string; title: string; description: string }) { return <a href={href} className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-blue-300 hover:shadow-sm"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-100 text-sm font-bold text-blue-700 group-hover:bg-blue-700 group-hover:text-white">{number}</span><span><span className="block text-sm font-bold text-slate-900">{title}</span><span className="block text-xs text-slate-500">{description}</span></span></a>; }
function SectionHeader({ number, title, description }: { number: string; title: string; description: string }) { return <div className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">{number}</span><div><h2 className="text-lg font-bold text-slate-950">{title}</h2><p className="mt-0.5 text-sm text-slate-500">{description}</p></div></div>; }
function Field({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) { return <label className={`block text-sm font-medium text-slate-700 ${className}`}>{label}{children}</label>; }
function NumberWithSuffix({ value, suffix, min, max, onChange }: { value: number; suffix: string; min: number; max: number; onChange: (value: number) => void }) { return <div className="relative"><input className={`${inputClass} pr-16`} type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))}/><span className="pointer-events-none absolute bottom-2.5 right-3 text-xs text-slate-500">{suffix}</span></div>; }
function ToggleChoice({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) { return <label className={`cursor-pointer rounded-xl border px-3 py-2 text-sm font-semibold transition ${checked ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}><input className="sr-only" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}/>{checked ? '✓ ' : ''}{label}</label>; }
function Switch({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) { return <span className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-blue-600' : 'bg-slate-300'}`}><input className="peer sr-only" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}/><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'translate-x-5' : 'translate-x-0'}`}/></span>; }
function Notice({ tone, onClose, children }: { tone: 'error' | 'success'; onClose: () => void; children: React.ReactNode }) { return <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start justify-between gap-3 rounded-xl p-4 text-sm ${tone === 'error' ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}><span>{children}</span><button type="button" aria-label="Cerrar mensaje" className="font-bold opacity-60 hover:opacity-100" onClick={onClose}>×</button></div>; }
function EmptyState({ title, description }: { title: string; description: string }) { return <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center"><p className="font-semibold text-slate-800">{title}</p><p className="mt-1 text-sm text-slate-500">{description}</p></div>; }
function EmptyAccess() { return <main className="mx-auto max-w-xl p-8"><div className="rounded-2xl border border-slate-200 bg-white p-8 text-center"><h1 className="text-xl font-bold text-slate-900">Configuración restringida</h1><p className="mt-2 text-sm text-slate-600">Sólo la persona administradora de la clínica puede modificar las reservas en línea.</p></div></main>; }
function PageSkeleton() { return <div className="animate-pulse space-y-5" aria-label="Cargando configuración"><div className="h-48 rounded-2xl bg-white"/><div className="grid grid-cols-3 gap-3"><div className="h-20 rounded-xl bg-white"/><div className="h-20 rounded-xl bg-white"/><div className="h-20 rounded-xl bg-white"/></div><div className="h-72 rounded-2xl bg-white"/></div>; }
function GlobeIcon() { return <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>; }
function CalendarOffIcon() { return <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1ZM9 13l6 6M15 13l-6 6"/></svg>; }

function defaultWeekSchedule(): WeekSchedule { return Object.fromEntries(DAYS.map((day) => [day.value, { enabled: day.value >= 1 && day.value <= 5, from: '09:00', to: '18:00' }])) as WeekSchedule; }
function scheduleFromRules(rules: AvailabilityRule[]): WeekSchedule { const week = defaultWeekSchedule(); for (const day of DAYS) week[day.value] = { enabled: false, from: '09:00', to: '18:00' }; for (const rule of rules) week[rule.weekday] = { enabled: true, from: rule.inicio_local.slice(0, 5), to: rule.fin_local.slice(0, 5) }; return rules.length ? week : defaultWeekSchedule(); }
function isBookingReady(readiness: BookingReadiness | null) { return !!readiness && readiness.publicada && readiness.featureActiva && readiness.planPermitido && readiness.suscripcionVigente && readiness.serviciosPublicos > 0 && readiness.medicosPublicables > 0; }
function readinessMissing(readiness: BookingReadiness | null): string[] { if (!readiness) return []; const missing: string[] = []; if (!readiness.publicada) missing.push('Activa “Aceptar reservas en línea” y guarda los cambios.'); if (readiness.publicada && !readiness.featureActiva) missing.push('Guarda los cambios para terminar de habilitar las reservas.'); if (!readiness.planPermitido) missing.push('Tu plan actual no incluye reservas públicas.'); if (!readiness.suscripcionVigente) missing.push('La suscripción necesita estar vigente.'); if (!readiness.serviciosPublicos) missing.push('Publica por lo menos un servicio.'); if (!readiness.medicosPublicables) missing.push('Asigna un profesional activo a un servicio publicado.'); return missing; }
function messageFrom(caught: unknown, fallback: string) { return caught instanceof ApiError ? caught.message : fallback; }
function formatPrice(priceCentavos: number) { return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(priceCentavos / 100); }
function deliveryLabel(kind: MessagingDelivery['kind']) { return ({ confirmation: 'La confirmación', reminder: 'El recordatorio', rescheduled: 'El aviso de reprogramación', cancelled: 'El aviso de cancelación', recall: 'El aviso de seguimiento' } as const)[kind]; }
function todayInputValue() { const today = new Date(); return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`; }
