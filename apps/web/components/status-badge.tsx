import type { AppointmentStatus } from '@healthflow/shared-types';

const STYLES: Record<AppointmentStatus, { label: string; className: string }> = {
  agendada: { label: 'Agendada', className: 'bg-slate-100 text-slate-600' },
  en_espera: { label: 'En espera', className: 'bg-amber-100 text-amber-700' },
  en_consulta: { label: 'En consulta', className: 'bg-blue-100 text-brand-blue' },
  finalizada: { label: 'Finalizada', className: 'bg-emerald-100 text-emerald-700' },
  cancelada: { label: 'Cancelada', className: 'bg-red-100 text-red-600' },
  no_asistio: { label: 'No asistió', className: 'bg-slate-200 text-slate-500' },
};

/** Mismos colores que STYLES, en hex, para consumidores que no pueden usar clases Tailwind (p.ej. estilos inline de react-big-calendar). */
export const STATUS_HEX: Record<AppointmentStatus, string> = {
  agendada: '#64748b',
  en_espera: '#d97706',
  en_consulta: '#2563EB',
  finalizada: '#059669',
  cancelada: '#dc2626',
  no_asistio: '#94a3b8',
};

/** Fondo claro (tint) por estatus, para chips de cita en el calendario: el color vive en el riel y el punto, no en todo el bloque. */
export const STATUS_TINT: Record<AppointmentStatus, string> = {
  agendada: '#f8fafc',
  en_espera: '#fef8f0',
  en_consulta: '#eff6ff',
  finalizada: '#ecfdf5',
  cancelada: '#fef2f2',
  no_asistio: '#f8fafc',
};

export const STATUS_LABEL: Record<AppointmentStatus, string> = Object.fromEntries(
  Object.entries(STYLES).map(([k, v]) => [k, v.label]),
) as Record<AppointmentStatus, string>;

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const s = STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${s.className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}
