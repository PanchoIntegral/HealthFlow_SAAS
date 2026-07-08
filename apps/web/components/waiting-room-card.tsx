import type { WaitingRoomEntry } from '@healthflow/shared-types';
import { StatusBadge } from './status-badge';

function initials(nombre: string): string {
  return nombre
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();
}

function waitMinutes(checkinAt: string | null): number | null {
  if (!checkinAt) return null;
  return Math.max(0, Math.round((Date.now() - new Date(checkinAt).getTime()) / 60000));
}

export function WaitingRoomCard({
  entry,
  canCheckIn,
  canConsult,
  onCheckIn,
  onStartConsultation,
  pending,
}: {
  entry: WaitingRoomEntry;
  canCheckIn: boolean;
  canConsult: boolean;
  onCheckIn: (id: string) => void;
  onStartConsultation: (id: string) => void;
  pending: boolean;
}) {
  const wait = waitMinutes(entry.checkinAt);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
            {initials(entry.patientNombre)}
          </div>
          <div>
            <p className="font-semibold leading-tight">{entry.patientNombre}</p>
            <p className="text-xs text-slate-500">{entry.patientEdad} años</p>
          </div>
        </div>
        <StatusBadge status={entry.estatus} />
      </div>

      {entry.motivo && (
        <p className="text-sm text-slate-600">
          <span className="text-slate-400">Motivo:</span> {entry.motivo}
        </p>
      )}

      {entry.estatus === 'en_espera' && wait !== null && (
        <p className="text-sm font-medium text-amber-600">⏱ Esperando {wait} min</p>
      )}

      {entry.estatus === 'agendada' && canCheckIn && (
        <button
          onClick={() => onCheckIn(entry.appointmentId)}
          disabled={pending}
          className="rounded-lg border border-slate-300 py-2 text-sm font-semibold text-slate-700 transition hover:border-brand-blue hover:text-brand-blue disabled:opacity-50"
        >
          {pending ? 'Registrando…' : 'Marcar llegada'}
        </button>
      )}

      {entry.estatus === 'en_espera' && canConsult && (
        <button
          onClick={() => onStartConsultation(entry.appointmentId)}
          disabled={pending}
          className="rounded-lg bg-gradient-to-r from-brand-blue to-brand-green py-2 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-50"
        >
          {pending ? 'Abriendo…' : 'Iniciar consulta'}
        </button>
      )}

      {entry.estatus === 'en_consulta' && canConsult && (
        <button
          onClick={() => onStartConsultation(entry.appointmentId)}
          className="rounded-lg border border-brand-blue py-2 text-sm font-semibold text-brand-blue transition hover:bg-brand-blue/5"
        >
          Continuar consulta →
        </button>
      )}
    </div>
  );
}
