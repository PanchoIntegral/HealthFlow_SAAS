import type { AppointmentStatus } from '@healthflow/shared-types';

const STYLES: Record<AppointmentStatus, { label: string; className: string }> = {
  agendada: { label: 'Agendada', className: 'bg-slate-100 text-slate-600' },
  en_espera: { label: 'En espera', className: 'bg-amber-100 text-amber-700' },
  en_consulta: { label: 'En consulta', className: 'bg-blue-100 text-brand-blue' },
  finalizada: { label: 'Finalizada', className: 'bg-emerald-100 text-emerald-700' },
  cancelada: { label: 'Cancelada', className: 'bg-red-100 text-red-600' },
  no_asistio: { label: 'No asistió', className: 'bg-slate-200 text-slate-500' },
};

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const s = STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${s.className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}
