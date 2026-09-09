'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import type { AvailabilitySlot, BookingService, PublicAppointmentSummary, PublicBookingPage } from '@healthflow/shared-types';
import { api, ApiError } from '../../../lib/api';

const inputClass='mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-[15px] text-slate-900 outline-none transition focus:border-blue-600 focus:ring-4 focus:ring-blue-100';
type DayGroup={key:string;weekday:string;date:string;fullLabel:string;isToday:boolean;slots:AvailabilitySlot[]};

export default function BookingPage({params,searchParams}:{params:Promise<{slug:string}>;searchParams:Promise<{doctorId?:string|string[]}>}){
  const{slug}=use(params),query=use(searchParams),doctorId=Array.isArray(query.doctorId)?query.doctorId[0]:query.doctorId;
  return <Booking slug={slug} initialDoctorId={doctorId}/>;
}

function Booking({slug,initialDoctorId}:{slug:string;initialDoctorId?:string}){
  const[page,setPage]=useState<PublicBookingPage|null>(null),[serviceId,setServiceId]=useState(''),[doctorId,setDoctorId]=useState('');
  const[slots,setSlots]=useState<AvailabilitySlot[]>([]),[slot,setSlot]=useState<AvailabilitySlot|null>(null),[selectedDay,setSelectedDay]=useState('');
  const[loading,setLoading]=useState(true),[slotsLoading,setSlotsLoading]=useState(false),[slotsError,setSlotsError]=useState(''),[refreshKey,setRefreshKey]=useState(0);
  const[saving,setSaving]=useState(false),[error,setError]=useState(''),[done,setDone]=useState<PublicAppointmentSummary|null>(null);
  const[nombre,setNombre]=useState(''),[dob,setDob]=useState(''),[phone,setPhone]=useState(''),[email,setEmail]=useState('');
  const[channel,setChannel]=useState<'whatsapp'|'email'|'ninguno'>('whatsapp'),[optIn,setOptIn]=useState(false),[privacy,setPrivacy]=useState(false);
  const scheduleRef=useRef<HTMLElement>(null),detailsRef=useRef<HTMLElement>(null);

  useEffect(()=>{let active=true;api.publicBooking(slug).then(response=>{if(!active)return;setPage(response);setServiceId(response.services[0]?.id??'');if(initialDoctorId&&response.doctors.some(doctor=>doctor.id===initialDoctorId))setDoctorId(initialDoctorId);}).catch(()=>active&&setError('Esta página de reservas no está disponible.')).finally(()=>active&&setLoading(false));return()=>{active=false;};},[slug,initialDoctorId]);

  useEffect(()=>{if(!serviceId)return;let active=true;const{from,to}=ventanaDisponibilidad();setSlotsLoading(true);setSlotsError('');setSlot(null);api.publicAvailability(slug,serviceId,doctorId||undefined,from,to).then(response=>active&&setSlots(response)).catch(()=>{if(!active)return;setSlots([]);setSlotsError('No pudimos consultar los horarios disponibles.');}).finally(()=>active&&setSlotsLoading(false));return()=>{active=false;};},[slug,serviceId,doctorId,refreshKey]);

  const days=useMemo(()=>groupSlotsByDay(slots,page?.timezone??'America/Mexico_City'),[slots,page?.timezone]);
  useEffect(()=>{if(!days.length){setSelectedDay('');return;}if(!days.some(day=>day.key===selectedDay))setSelectedDay(days[0]!.key);},[days,selectedDay]);
  const activeDay=days.find(day=>day.key===selectedDay)??days[0],selectedService=page?.services.find(service=>service.id===serviceId);
  const selectedDoctor=slot?.doctorName??page?.doctors.find(doctor=>doctor.id===doctorId)?.nombre,currentStep=slot?3:2;

  function chooseSlot(nextSlot:AvailabilitySlot){setSlot(nextSlot);setError('');window.setTimeout(()=>detailsRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),80);}
  async function submit(event:React.FormEvent){event.preventDefault();if(!slot||!page)return;setSaving(true);setError('');try{setDone(await api.createPublicAppointment(slug,{serviceId,doctorId:slot.doctorId,start:slot.start,patient:{nombre,fechaNacimiento:dob,telefono:phone,email:email||undefined,canalPreferido:channel,whatsappOptIn:optIn,privacyNoticeAccepted:true,privacyNoticeVersion:page.privacyNoticeVersion}}));}catch(caught){setError(caught instanceof ApiError?caught.message:'No pudimos reservar la cita');if(caught instanceof ApiError&&caught.status===409){setSlot(null);setRefreshKey(value=>value+1);window.setTimeout(()=>scheduleRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),80);}}finally{setSaving(false);}}

  if(loading)return <LoadingState/>;
  if(!page)return <UnavailableState message={error}/>;
  if(done)return <SuccessState appointment={done} timezone={page.timezone}/>;

  return <Shell>
    <BookingHeader clinicName={page.clinicName} currentStep={currentStep}/>
    <form onSubmit={submit} className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <StepTitle number={1} title="Elige tu atención" complete/>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">Servicio<select className={inputClass} value={serviceId} onChange={event=>setServiceId(event.target.value)}>{page.services.map(service=><option key={service.id} value={service.id}>{service.nombre} · {service.duracionMinutos} min{service.precioCentavos!=null?` · ${formatPrice(service.precioCentavos)}`:''}</option>)}</select></label>
            <label className="text-sm font-medium text-slate-700">Profesional<select className={inputClass} value={doctorId} onChange={event=>setDoctorId(event.target.value)}><option value="">Primero disponible</option>{page.doctors.map(doctor=><option key={doctor.id} value={doctor.id}>{doctor.nombre}{doctor.especialidad?` · ${doctor.especialidad}`:''}</option>)}</select></label>
          </div>
          <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-slate-500"><InfoIcon/>Los precios son informativos. No se realizará ningún cargo en esta página.</p>
        </section>

        <section ref={scheduleRef} className="scroll-mt-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <StepTitle number={2} title="Selecciona fecha y hora" active={!slot} complete={!!slot}/>
          {slotsLoading?<AvailabilitySkeleton/>:slotsError?<InlineState title="No pudimos cargar la disponibilidad" description="Revisa tu conexión e inténtalo nuevamente." action="Reintentar" onAction={()=>setRefreshKey(value=>value+1)}/>:days.length===0?<InlineState title="No hay horarios en los próximos 7 días" description="Puedes elegir otro profesional o volver a consultar más tarde."/>:<>
            <div className="-mx-1 mt-5 flex gap-2 overflow-x-auto px-1 pb-2" role="tablist" aria-label="Fechas disponibles">
              {days.map(day=>{const selected=day.key===activeDay?.key;return <button type="button" role="tab" aria-selected={selected} key={day.key} onClick={()=>{setSelectedDay(day.key);setSlot(null);}} className={`min-w-[96px] rounded-xl border px-3 py-3 text-center transition ${selected?'border-blue-600 bg-blue-600 text-white shadow-sm':'border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50'}`}><span className={`block text-xs font-medium ${selected?'text-blue-100':'text-slate-500'}`}>{day.isToday?'Hoy':day.weekday}</span><span className="mt-0.5 block text-sm font-bold capitalize">{day.date}</span><span className={`mt-1 block text-[11px] ${selected?'text-blue-100':'text-slate-400'}`}>{day.slots.length} {day.slots.length===1?'hora':'horas'}</span></button>;})}
            </div>
            {activeDay?<div className="mt-5" role="tabpanel"><p className="text-sm font-semibold capitalize text-slate-800">{activeDay.fullLabel}</p><p className="mt-1 text-xs text-slate-500">Horas locales de la clínica.</p><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">{activeDay.slots.map(availableSlot=>{const selected=slot?.start===availableSlot.start&&slot.doctorId===availableSlot.doctorId;return <button type="button" aria-pressed={selected} key={`${availableSlot.doctorId}-${availableSlot.start}`} onClick={()=>chooseSlot(availableSlot)} className={`rounded-xl border px-3 py-3 text-sm font-semibold transition focus:outline-none focus:ring-4 focus:ring-blue-100 ${selected?'border-blue-600 bg-blue-600 text-white shadow-sm':'border-slate-200 bg-white text-slate-700 hover:border-blue-500 hover:text-blue-700'}`}>{formatTime(availableSlot.start,page.timezone)}</button>;})}</div></div>:null}
          </>}
        </section>

        {slot?<section ref={detailsRef} className="scroll-mt-5 rounded-2xl border border-blue-200 bg-white p-5 shadow-[0_16px_35px_-28px_rgba(37,99,235,0.45)] sm:p-6">
          <div className="flex items-start justify-between gap-4"><StepTitle number={3} title="Completa tus datos" active/><button type="button" onClick={()=>scheduleRef.current?.scrollIntoView({behavior:'smooth',block:'start'})} className="shrink-0 text-xs font-semibold text-blue-700 hover:underline">Cambiar horario</button></div>
          <div className="mt-4 rounded-xl bg-blue-50 p-4 lg:hidden"><p className="text-xs font-bold uppercase tracking-[0.1em] text-blue-700">Horario elegido</p><p className="mt-1 text-sm font-bold capitalize text-slate-900">{formatAppointment(slot.start,page.timezone)}</p><p className="mt-0.5 text-xs text-slate-600">{selectedService?.nombre} · {selectedDoctor}</p></div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Nombre completo"><input className={inputClass} required minLength={2} autoComplete="name" value={nombre} onChange={event=>setNombre(event.target.value)} placeholder="Como aparece en tu identificación"/></Field>
            <Field label="Fecha de nacimiento"><input className={inputClass} required type="date" max={todayInputValue()} autoComplete="bday" value={dob} onChange={event=>setDob(event.target.value)}/></Field>
            <Field label="Teléfono"><input className={inputClass} required type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={event=>setPhone(event.target.value)} placeholder="10 dígitos"/></Field>
            <Field label={channel==='email'?'Correo electrónico':'Correo electrónico (opcional)'}><input className={inputClass} required={channel==='email'} type="email" inputMode="email" autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} placeholder="nombre@correo.com"/></Field>
          </div>
          <fieldset className="mt-5"><legend className="text-sm font-medium text-slate-700">¿Cómo deseas recibir avisos?</legend><div className="mt-2 grid grid-cols-3 gap-2">{([['whatsapp','WhatsApp'],['email','Correo'],['ninguno','Sin avisos']] as const).map(([value,label])=><label key={value} className={`cursor-pointer rounded-xl border px-2 py-3 text-center text-xs font-semibold transition ${channel===value?'border-blue-600 bg-blue-50 text-blue-700':'border-slate-200 text-slate-600 hover:border-slate-300'}`}><input className="sr-only" type="radio" name="channel" value={value} checked={channel===value} onChange={()=>setChannel(value)}/>{label}</label>)}</div></fieldset>
          <div className="mt-5 space-y-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
            {channel==='whatsapp'?<label className="flex cursor-pointer items-start gap-3"><input className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600" type="checkbox" checked={optIn} onChange={event=>setOptIn(event.target.checked)}/><span>Acepto recibir la confirmación y recordatorios de esta cita por WhatsApp.</span></label>:null}
            <label className="flex cursor-pointer items-start gap-3"><input className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600" required type="checkbox" checked={privacy} onChange={event=>setPrivacy(event.target.checked)}/><span>Acepto el aviso de privacidad <span className="text-slate-500">({page.privacyNoticeVersion})</span>.</span></label>
          </div>
          {error?<p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>:null}
          <button className="mt-5 flex w-full items-center justify-center rounded-xl bg-blue-700 px-5 py-3.5 font-semibold text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-45" disabled={saving||!privacy||(channel==='whatsapp'&&!optIn)}>{saving?'Reservando tu cita…':'Confirmar reserva'}</button>
          <p className="mt-3 text-center text-xs text-slate-500">Podrás confirmar, cancelar o reprogramar desde el enlace que recibirás.</p>
        </section>:null}
      </div>
      <AppointmentSummary service={selectedService} doctorName={selectedDoctor} slot={slot} timezone={page.timezone}/>
    </form>
  </Shell>;
}

function BookingHeader({clinicName,currentStep}:{clinicName:string;currentStep:number}){const steps=['Atención','Horario','Tus datos'];return <header className="mb-6"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-blue-600 to-emerald-500 text-white shadow-sm"><PulseIcon/></span><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">Reserva en línea</p><h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">{clinicName}</h1></div></div><div className="mt-6 flex items-center" aria-label={`Paso ${currentStep} de 3`}>{steps.map((step,index)=>{const number=index+1,reached=number<=currentStep;return <div key={step} className={`flex items-center ${index<steps.length-1?'flex-1':''}`}><div className="flex items-center gap-2"><span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${reached?'bg-blue-600 text-white':'bg-slate-200 text-slate-500'}`}>{number<currentStep?'✓':number}</span><span className={`hidden text-xs font-semibold sm:block ${reached?'text-slate-800':'text-slate-400'}`}>{step}</span></div>{index<steps.length-1?<span className={`mx-3 h-px flex-1 ${number<currentStep?'bg-blue-500':'bg-slate-200'}`}/>:null}</div>;})}</div></header>;}
function StepTitle({number,title,active=false,complete=false}:{number:number;title:string;active?:boolean;complete?:boolean}){return <div className="flex items-center gap-3"><span className={`grid h-8 w-8 place-items-center rounded-full text-sm font-bold ${complete?'bg-emerald-100 text-emerald-700':active?'bg-blue-100 text-blue-700':'bg-slate-100 text-slate-500'}`}>{complete?'✓':number}</span><h2 className="text-lg font-bold text-slate-900">{title}</h2></div>;}

function AppointmentSummary({service,doctorName,slot,timezone}:{service?:BookingService;doctorName?:string;slot:AvailabilitySlot|null;timezone:string}){return <aside className="sticky top-5 hidden rounded-2xl border border-slate-200 bg-white p-5 lg:block" aria-label="Resumen de la cita"><p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Tu cita</p><div className="mt-4 space-y-4"><SummaryRow icon={<ServiceIcon/>} label="Servicio" value={service?.nombre??'Selecciona un servicio'}/><SummaryRow icon={<DoctorIcon/>} label="Profesional" value={doctorName??'Primero disponible'}/><SummaryRow icon={<CalendarIcon/>} label="Fecha y hora" value={slot?formatAppointment(slot.start,timezone):'Selecciona un horario'} highlighted={!!slot}/></div>{service?<div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-sm"><span className="text-slate-500">Duración</span><span className="font-semibold text-slate-800">{service.duracionMinutos} min</span></div>:null}</aside>;}
function SummaryRow({icon,label,value,highlighted=false}:{icon:React.ReactNode;label:string;value:string;highlighted?:boolean}){return <div className="flex gap-3"><span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${highlighted?'bg-blue-100 text-blue-700':'bg-slate-100 text-slate-500'}`}>{icon}</span><div className="min-w-0"><p className="text-xs text-slate-500">{label}</p><p className={`mt-0.5 text-sm font-semibold ${highlighted?'text-blue-700':'text-slate-800'}`}>{value}</p></div></div>;}
function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="text-sm font-medium text-slate-700">{label}{children}</label>;}
function AvailabilitySkeleton(){return <div className="mt-5 animate-pulse" aria-label="Cargando horarios"><div className="flex gap-2 overflow-hidden">{[1,2,3,4,5].map(item=><div key={item} className="h-20 min-w-[96px] rounded-xl bg-slate-100"/>)}</div><div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">{[1,2,3,4].map(item=><div key={item} className="h-11 rounded-xl bg-slate-100"/>)}</div></div>;}
function InlineState({title,description,action,onAction}:{title:string;description:string;action?:string;onAction?:()=>void}){return <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-5 text-center"><p className="font-semibold text-slate-800">{title}</p><p className="mt-1 text-sm text-slate-500">{description}</p>{action&&onAction?<button type="button" onClick={onAction} className="mt-3 text-sm font-semibold text-blue-700 hover:underline">{action}</button>:null}</div>;}
function LoadingState(){return <Shell><div className="animate-pulse space-y-5" aria-label="Cargando agenda"><div className="h-10 w-64 rounded-lg bg-slate-200"/><div className="h-32 rounded-2xl bg-white"/><div className="h-64 rounded-2xl bg-white"/></div></Shell>;}
function UnavailableState({message}:{message:string}){return <Shell narrow><div className="rounded-2xl bg-white p-8 text-center shadow-sm"><span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-red-50 text-red-600">!</span><h1 className="mt-4 text-xl font-bold text-slate-900">Agenda no disponible</h1><p className="mt-2 text-sm text-slate-600">{message}</p></div></Shell>;}
function SuccessState({appointment,timezone}:{appointment:PublicAppointmentSummary;timezone:string}){return <Shell narrow><div className="rounded-3xl border border-emerald-100 bg-white p-7 text-center shadow-sm sm:p-10"><span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-3xl text-emerald-700">✓</span><p className="mt-5 text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">Reserva realizada</p><h1 className="mt-2 text-2xl font-bold text-slate-950">Tu cita quedó reservada</h1><div className="mx-auto mt-6 max-w-sm rounded-2xl bg-slate-50 p-5 text-left"><p className="font-bold text-slate-900">{appointment.clinicName}</p><p className="mt-1 text-sm text-slate-600">{appointment.doctorName}</p><p className="mt-3 text-sm font-semibold capitalize text-blue-700">{formatAppointment(appointment.start,timezone)}</p></div>{appointment.manageUrl?<a className="mt-6 inline-flex rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-800" href={appointment.manageUrl}>Administrar mi cita</a>:null}<p className="mt-4 text-xs text-slate-500">Guarda el enlace para confirmar, cancelar o reprogramar.</p></div></Shell>;}
function Shell({children,narrow=false}:{children:React.ReactNode;narrow?:boolean}){return <main className="min-h-screen bg-gradient-to-br from-blue-50 via-slate-50 to-emerald-50 px-4 py-5 sm:py-8"><div className={`mx-auto ${narrow?'max-w-xl':'max-w-5xl'}`}>{children}<footer className="mt-6 flex items-center justify-center gap-2 text-center text-xs text-slate-500"><LockIcon/> Reservas protegidas mediante HealthFlow</footer></div></main>;}

function groupSlotsByDay(slots:AvailabilitySlot[],timezone:string):DayGroup[]{const formatter=new Intl.DateTimeFormat('es-MX',{timeZone:timezone,weekday:'short',day:'numeric',month:'short'}),fullFormatter=new Intl.DateTimeFormat('es-MX',{timeZone:timezone,weekday:'long',day:'numeric',month:'long'}),todayKey=dateKey(new Date(),timezone),groups=new Map<string,DayGroup>();for(const availableSlot of slots){const date=new Date(availableSlot.start),key=dateKey(date,timezone);if(!groups.has(key)){const parts=formatter.formatToParts(date);groups.set(key,{key,weekday:part(parts,'weekday').replace('.',''),date:`${part(parts,'day')} ${part(parts,'month').replace('.','')}`,fullLabel:fullFormatter.format(date),isToday:key===todayKey,slots:[]});}groups.get(key)!.slots.push(availableSlot);}return[...groups.values()];}
function dateKey(date:Date,timezone:string){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);return`${part(parts,'year')}-${part(parts,'month')}-${part(parts,'day')}`;}
function part(parts:Intl.DateTimeFormatPart[],type:Intl.DateTimeFormatPartTypes){return parts.find(item=>item.type===type)?.value??'';}
function formatTime(value:string,timezone:string){return new Date(value).toLocaleTimeString('es-MX',{hour:'numeric',minute:'2-digit',timeZone:timezone});}
function formatAppointment(value:string,timezone:string){return new Date(value).toLocaleString('es-MX',{weekday:'long',day:'numeric',month:'long',hour:'numeric',minute:'2-digit',timeZone:timezone});}
function formatPrice(priceCentavos:number){return new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN',maximumFractionDigits:0}).format(priceCentavos/100);}
function todayInputValue(){const today=new Date();return`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;}
function ventanaDisponibilidad(){const now=Date.now();return{from:new Date(now).toISOString(),to:new Date(now+7*86400000-1000).toISOString()};}

const iconClass='h-4 w-4';
function InfoIcon(){return <svg className={`${iconClass} mt-px shrink-0`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>;}
function PulseIcon(){return <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12h4l2-5 4 10 2-5h6"/></svg>;}
function ServiceIcon(){return <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M8 3v3M16 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z"/></svg>;}
function DoctorIcon(){return <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>;}
function CalendarIcon(){return <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z"/></svg>;}
function LockIcon(){return <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>;}
