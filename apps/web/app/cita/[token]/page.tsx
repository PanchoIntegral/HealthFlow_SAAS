'use client';

import { use, useEffect, useState } from 'react';
import type { AvailabilitySlot, PublicAppointmentSummary } from '@healthflow/shared-types';
import { api, ApiError } from '../../../lib/api';

export default function ManagePage({params}:{params:Promise<{token:string}>}){
  const {token}=use(params);
  const [item,setItem]=useState<PublicAppointmentSummary|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [showCancel,setShowCancel]=useState(false);
  const [showSlots,setShowSlots]=useState(false);
  const [slots,setSlots]=useState<AvailabilitySlot[]>([]);
  const [slotsLoading,setSlotsLoading]=useState(false);
  const [selected,setSelected]=useState<AvailabilitySlot|null>(null);
  const [week,setWeek]=useState(0);
  const [refresh,setRefresh]=useState(0);

  useEffect(()=>{api.publicAppointment(token).then(setItem).catch(()=>setError('Este enlace no es válido o ya venció.'));},[token]);
  useEffect(()=>{
    if(!showSlots||!item)return;
    let active=true;
    const {from,to}=weekWindow(week);
    setSlotsLoading(true);setError('');setSelected(null);
    api.publicAppointmentAvailability(token,from,to).then(value=>active&&setSlots(value)).catch(caught=>{
      if(active){setSlots([]);setError(caught instanceof ApiError?caught.message:'No se pudo consultar la disponibilidad');}
    }).finally(()=>active&&setSlotsLoading(false));
    return()=>{active=false;};
  },[token,item,showSlots,week,refresh]);

  async function action(kind:'confirm'|'cancel'|'reschedule'){
    if(kind==='reschedule'&&!selected)return;
    setBusy(true);setError('');
    try{
      const updated=kind==='confirm'
        ?await api.confirmPublicAppointment(token)
        :kind==='cancel'
          ?await api.cancelPublicAppointment(token)
          :await api.reschedulePublicAppointment(token,selected!.start,selected!.doctorId);
      setItem(updated);setShowCancel(false);setShowSlots(false);setSelected(null);
    }catch(caught){
      setError(caught instanceof ApiError?caught.message:'No se pudo actualizar la cita');
      if(caught instanceof ApiError&&caught.status===409&&kind==='reschedule')setRefresh(value=>value+1);
    }finally{setBusy(false);}
  }

  return <main className="grid min-h-screen place-items-center bg-slate-50 p-4">
    <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-lg sm:p-8">
      <p className="text-sm font-semibold text-blue-700">Administrar cita</p>
      {item?<>
        <h1 className="mt-2 text-2xl font-bold">{item.clinicName}</h1>
        <div className="my-6 rounded-2xl bg-slate-50 p-5">
          <p className="font-semibold">{formatDate(item.start,item.timezone)}</p>
          <p className="mt-1 text-slate-600">{item.doctorName}</p>
          <p className="mt-3 text-sm">Estado: <b>{item.status==='cancelada'?'Cancelada':item.confirmationStatus==='confirmada'?'Asistencia confirmada':'Reservada'}</b></p>
        </div>
        {item.status!=='cancelada'?<div className="grid gap-3">
          <button disabled={busy||item.confirmationStatus==='confirmada'} onClick={()=>action('confirm')} className="rounded-xl bg-emerald-700 p-3 font-semibold text-white disabled:opacity-50">{item.confirmationStatus==='confirmada'?'Asistencia confirmada':'Confirmar asistencia'}</button>
          <button disabled={busy} onClick={()=>setShowSlots(value=>!value)} className="rounded-xl border border-blue-700 p-3 font-semibold text-blue-700">{showSlots?'Cerrar horarios':'Elegir otro horario'}</button>
          {showSlots?<section className="rounded-2xl border border-slate-200 p-4" aria-label="Horarios disponibles">
            <div className="flex items-center justify-between gap-3"><button disabled={week===0||slotsLoading} onClick={()=>setWeek(value=>Math.max(0,value-1))} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Anterior</button><p className="text-center text-sm font-semibold">Semana {week+1}</p><button disabled={slotsLoading} onClick={()=>setWeek(value=>value+1)} className="rounded-lg border px-3 py-2 text-sm">Siguiente</button></div>
            {slotsLoading?<p className="py-6 text-center text-sm text-slate-500">Consultando disponibilidad…</p>:slots.length?<div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">{slots.map(slot=><button key={`${slot.doctorId}-${slot.start}`} onClick={()=>setSelected(slot)} className={`rounded-xl border p-3 text-left text-xs ${selected?.start===slot.start&&selected.doctorId===slot.doctorId?'border-blue-600 bg-blue-50 text-blue-800':'border-slate-200'}`}><b className="block text-sm">{formatDate(slot.start,item.timezone)}</b><span>{slot.doctorName}</span></button>)}</div>:<p className="py-6 text-center text-sm text-slate-500">No hay horarios disponibles en esta semana.</p>}
            {selected?<div className="mt-4 rounded-xl bg-blue-50 p-4"><p className="text-sm">Nuevo horario: <b>{formatDate(selected.start,item.timezone)}</b> con {selected.doctorName}.</p><button disabled={busy} onClick={()=>action('reschedule')} className="mt-3 w-full rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white">Confirmar reprogramación</button></div>:null}
          </section>:null}
          {showCancel?<div className="rounded-xl bg-red-50 p-4"><p className="mb-3 text-sm text-red-800">¿Confirmas que deseas cancelar? Esta acción no elimina la cita.</p><button disabled={busy} onClick={()=>action('cancel')} className="rounded-lg bg-red-700 px-4 py-2 text-white">Sí, cancelar</button></div>:<button onClick={()=>setShowCancel(true)} className="p-2 text-sm text-red-700 underline">Cancelar cita</button>}
        </div>:null}
      </>:!error?<p>Cargando…</p>:null}
      {error?<p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>:null}
      <p className="mt-8 text-center text-xs text-slate-400">HealthFlow protege tus datos; este resumen no muestra información clínica.</p>
    </div>
  </main>;
}

function weekWindow(offset:number):{from:string;to:string}{
  const from=new Date();from.setSeconds(0,0);from.setDate(from.getDate()+offset*7);
  const to=new Date(from);to.setDate(to.getDate()+7);
  return {from:from.toISOString(),to:to.toISOString()};
}

function formatDate(value:string,timezone:string):string{
  return new Intl.DateTimeFormat('es-MX',{dateStyle:'medium',timeStyle:'short',timeZone:timezone}).format(new Date(value));
}
