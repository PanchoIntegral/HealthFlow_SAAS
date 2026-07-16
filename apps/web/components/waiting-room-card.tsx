import type { WaitingRoomEntry } from '@healthflow/shared-types';
import { StatusBadge } from './status-badge';
import { FacturaPanel } from './factura-panel';

const TERMINAL_STATUSES = new Set(['finalizada', 'cancelada', 'no_asistio']);

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

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
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
  const urgent = wait !== null && wait >= 20;

  return (
    <div
      className={`flex flex-col gap-3 rounded-2xl border bg-white p-4 shadow-sm transition hover:shadow-md ${
        urgent && entry.estatus === 'en_espera' ? 'border-red-200' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
            {initials(entry.patientNombre)}
          </div>
          <div>
            <p className="font-semibold leading-tight">{entry.patientNombre}</p>
            <p className="text-xs text-slate-500">{entry.patientEdad} años</p>
          </div>
        </div>
        {TERMINAL_STATUSES.has(entry.estatus) ? (
          <StatusBadge status={entry.estatus} />
        ) : (
          <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
            {hora(entry.inicioProgramado)}
          </span>
        )}
      </div>

      {entry.motivo && (
        <p className="text-sm text-slate-600">
          <span className="text-slate-400">Motivo:</span> {entry.motivo}
        </p>
      )}

      {entry.estatus === 'en_espera' && wait !== null && (
        <p className={`text-sm font-medium ${urgent ? 'text-red-600' : 'text-amber-600'}`}>
          ⏱ Esperando {wait} min
        </p>
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

      {/* Consulta terminada → estado de facturación y acciones (timbrar/cancelar) */}
      {entry.estatus === 'finalizada' && <FacturaPanel appointmentId={entry.appointmentId} />}
    </div>
  );
}
