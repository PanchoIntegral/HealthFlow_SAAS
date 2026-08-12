import type { HorarioAtencion } from '@healthflow/shared-types';

/**
 * Generación de los horarios que se le ofrecen al paciente para reagendar.
 *
 * Puro y con reloj por parámetro: los huecos ocupados los aporta quien llama
 * (el repositorio de citas, bajo RLS), de modo que esta función no puede leer
 * la agenda de nadie por su cuenta.
 *
 * **Limitación conocida:** el modelo no tiene horarios de atención por médico,
 * ni vacaciones, ni comidas. `horario_atencion` en la configuración de la
 * clínica es un mínimo viable para el piloto; ofrecer un hueco en el que el
 * médico no está es un error recuperable —la clínica lo mueve— pero conviene
 * no dejarlo así mucho tiempo.
 */

export interface Ocupado {
  inicio: Date;
  fin: Date;
}

export interface Hueco {
  inicio: Date;
  fin: Date;
}

/** Cuánto se adelanta como mínimo un hueco respecto a ahora. */
export const ANTICIPACION_MINIMA_MS = 2 * 60 * 60 * 1000;
/** Hasta dónde se ofrece agenda. Más allá no es un reagendado, es una cita nueva. */
export const DIAS_MAXIMOS = 60;
/** Cuántos huecos se devuelven como mucho: la página se lee en un teléfono. */
export const MAX_HUECOS = 30;

export function generarHuecos(opciones: {
  desde: Date;
  dias: number;
  duracionMinutos: number;
  horario: HorarioAtencion;
  tz: string;
  ocupados: Ocupado[];
  ahora: Date;
  max?: number;
}): Hueco[] {
  const { desde, dias, duracionMinutos, horario, tz, ocupados, ahora } = opciones;
  const max = opciones.max ?? MAX_HUECOS;
  const duracionMs = duracionMinutos * 60_000;
  const minimo = new Date(ahora.getTime() + ANTICIPACION_MINIMA_MS);

  const huecos: Hueco[] = [];
  const diaBase = new Date(Math.max(desde.getTime(), ahora.getTime()));

  for (let d = 0; d < Math.min(dias, DIAS_MAXIMOS) && huecos.length < max; d++) {
    const dia = new Date(diaBase.getTime() + d * 24 * 60 * 60 * 1000);
    if (!horario.dias.includes(diaSemanaLocal(dia, tz))) continue;

    const apertura = instanteLocal(dia, horario.desde, tz);
    const cierre = instanteLocal(dia, horario.hasta, tz);

    for (
      let inicio = apertura;
      inicio.getTime() + duracionMs <= cierre.getTime() && huecos.length < max;
      inicio = new Date(inicio.getTime() + duracionMs)
    ) {
      const fin = new Date(inicio.getTime() + duracionMs);
      // Nada a menos de dos horas: al paciente no le sirve un hueco al que no
      // puede llegar, y a la clínica no le sirve una agenda que cambia encima.
      if (inicio.getTime() < minimo.getTime()) continue;
      if (ocupados.some((o) => seTraslapan(inicio, fin, o))) continue;
      huecos.push({ inicio, fin });
    }
  }
  return huecos;
}

export function seTraslapan(inicio: Date, fin: Date, otro: Ocupado): boolean {
  // Contiguo no es traslape: una cita que termina a las 10:00 no choca con
  // otra que empieza a las 10:00.
  return inicio.getTime() < otro.fin.getTime() && fin.getTime() > otro.inicio.getTime();
}

/** 1 = lunes … 7 = domingo, según el calendario de la clínica. */
export function diaSemanaLocal(momento: Date, tz: string): number {
  const nombre = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(
    momento,
  );
  const dias: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return dias[nombre] ?? 1;
}

/**
 * El instante en que el reloj de esa zona marca `HH:MM` el mismo día local que
 * `momento`.
 *
 * Se calcula por corrección iterativa en vez de construir la fecha a mano: el
 * offset de una zona depende del instante (horario de verano), así que sumar
 * "el offset de hoy" falla justo los días de cambio.
 */
export function instanteLocal(momento: Date, hhmm: string, tz: string): Date {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  let t = momento.getTime();

  for (let i = 0; i < 3; i++) {
    const { hora, minuto } = relojLocal(new Date(t), tz);
    const delta = (h - hora) * 3_600_000 + (m - minuto) * 60_000;
    if (delta === 0) break;
    t += delta;
  }
  // Sin segundos ni milisegundos heredados del instante de partida.
  return new Date(Math.floor(t / 60_000) * 60_000);
}

function relojLocal(momento: Date, tz: string): { hora: number; minuto: number } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(momento);
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? 0);
  return { hora: valor('hour') % 24, minuto: valor('minute') };
}
