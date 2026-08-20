import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Formats } from 'react-big-calendar';

export type FormatoHora = '12h' | '24h';

/** Mismo formateo que se repetía suelto en dashboard, sala de espera y caja. */
export function formatearHora(iso: string, formato: FormatoHora): string {
  return new Date(iso).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: formato === '12h',
  });
}

/**
 * Prop `formats` de `<Calendar>` (react-big-calendar): controla la rejilla de
 * horas y el rango de hora sobre cada cita, que si no se pasa usa el default
 * de la librería (12h con AM/PM) sin importar la preferencia del usuario.
 */
export function calendarFormats(formato: FormatoHora): Formats {
  const patron = formato === '24h' ? 'HH:mm' : 'h:mm a';
  const fmt = (date: Date) => format(date, patron, { locale: es });
  return {
    timeGutterFormat: patron,
    eventTimeRangeFormat: ({ start, end }) => `${fmt(start)} – ${fmt(end)}`,
    agendaTimeRangeFormat: ({ start, end }) => `${fmt(start)} – ${fmt(end)}`,
  };
}
