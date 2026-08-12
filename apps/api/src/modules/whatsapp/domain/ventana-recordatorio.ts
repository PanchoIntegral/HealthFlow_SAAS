/**
 * Cuándo sale el recordatorio de una cita.
 *
 * Tres reglas que no son evidentes:
 *
 * 1. **Zona horaria de la clínica, no del servidor.** Todo se guarda en
 *    `timestamptz`, pero "las 9 de la noche" es una hora local. Un servidor en
 *    UTC que use `getHours()` mandaría mensajes a las 3 de la mañana en Tijuana.
 *    Por eso la hora local se calcula siempre con `Intl.DateTimeFormat`.
 *
 * 2. **La ventana de silencio solo empuja hacia adelante.** Si el envío cae de
 *    madrugada se pasa a las 8am; nunca se adelanta a la noche anterior. Un
 *    recordatorio que llega antes de tiempo es peor que uno que llega tarde:
 *    el paciente lo lee, lo archiva mentalmente y se le olvida igual.
 *
 * 3. **Una cita agendada a última hora no dispara el recordatorio de 24h.**
 *    Si al planificar faltan menos de dos horas, el paciente acaba de hablar
 *    con la clínica y no hay nada que recordarle.
 */

/** Debajo de este margen la cita es inminente y el recordatorio sobra. */
export const MARGEN_MINIMO_MS = 2 * 60 * 60 * 1000;

export interface VentanaSilencio {
  /** Hora local a partir de la cual ya no se manda nada (0-23). */
  readonly desdeHora: number;
  /** Hora local a partir de la cual se puede volver a mandar (0-23). */
  readonly hastaHora: number;
  /** Zona IANA de la clínica, p. ej. 'America/Mexico_City'. */
  readonly tz: string;
}

/**
 * Momento en que debe salir el recordatorio, o `null` si esta cita ya no lo
 * amerita. El resultado puede ser anterior a `ahora` (una cita a 20h con
 * anticipación de 24h): eso es correcto y significa "sale en el próximo barrido".
 */
export function calcularProgramadoPara(
  inicioCita: Date,
  horasAnticipacion: number,
  ahora: Date,
  silencio: VentanaSilencio,
): Date | null {
  if (inicioCita.getTime() - ahora.getTime() < MARGEN_MINIMO_MS) return null;

  const ideal = new Date(inicioCita.getTime() - horasAnticipacion * 60 * 60 * 1000);
  const ajustado = evitarSilencio(ideal, silencio);

  // El ajuste por silencio nunca debe empujar el aviso a después de la cita:
  // en ese caso vale más mandarlo en la hora incómoda que no mandarlo.
  if (ajustado.getTime() >= inicioCita.getTime()) return ideal;
  return ajustado;
}

/**
 * Si `momento` cae dentro de la franja de silencio, lo mueve al primer instante
 * hábil siguiente (`hastaHora` en punto, hora local). Si no, lo deja intacto.
 */
export function evitarSilencio(momento: Date, silencio: VentanaSilencio): Date {
  const { desdeHora, hastaHora, tz } = silencio;
  // Franja vacía: la clínica desactivó el silencio.
  if (desdeHora === hastaHora) return momento;

  const hora = horaLocal(momento, tz);
  if (!enSilencio(hora, desdeHora, hastaHora)) return momento;

  return fijarHoraLocal(momento, hastaHora, tz);
}

/**
 * La franja puede cruzar la medianoche (21→8), que es el caso normal, o no
 * (1→6). `enSilencio` cubre ambos.
 */
export function enSilencio(hora: number, desdeHora: number, hastaHora: number): boolean {
  return desdeHora > hastaHora
    ? hora >= desdeHora || hora < hastaHora
    : hora >= desdeHora && hora < hastaHora;
}

/** Hora del día (0-23) que marca el reloj de esa zona en ese instante. */
export function horaLocal(momento: Date, tz: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(momento);
  const hora = partes.find((p) => p.type === 'hour')?.value;
  // 'hourCycle' h23 devuelve '24' para medianoche en algunos runtimes.
  return Number(hora) % 24;
}

/**
 * Devuelve el primer instante >= `momento` cuyo reloj local marque `hora:00`.
 *
 * Se calcula por corrección iterativa en lugar de construir la fecha local a
 * mano: el offset de una zona depende del instante (horario de verano), así que
 * "sumar el offset" usando el offset de hoy falla justo en los días de cambio.
 * Dos pasadas bastan para converger incluso ahí.
 */
export function fijarHoraLocal(momento: Date, hora: number, tz: string): Date {
  const HORA_MS = 60 * 60 * 1000;
  let t = momento.getTime();

  for (let i = 0; i < 2; i++) {
    const actual = horaLocal(new Date(t), tz);
    const minutos = minutoLocal(new Date(t), tz);
    let delta = (hora - actual) * HORA_MS - minutos * 60 * 1000;
    // Solo hacia adelante: si la hora objetivo ya pasó hoy, es la de mañana.
    if (delta < 0) delta += 24 * HORA_MS;
    t += delta;
    if (horaLocal(new Date(t), tz) === hora) break;
  }
  // Descarta segundos y milisegundos heredados del instante original.
  return new Date(Math.floor(t / 60000) * 60000);
}

function minutoLocal(momento: Date, tz: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    minute: 'numeric',
    hour12: false,
  }).formatToParts(momento);
  return Number(partes.find((p) => p.type === 'minute')?.value ?? 0);
}

/**
 * Espera antes del siguiente intento tras un fallo reintentable: 2, 4, 8, 16,
 * 32 minutos, con techo de una hora. El techo importa porque el recordatorio
 * pierde valor con el tiempo — reintentar cada 12 horas no le sirve a nadie.
 */
export const MAX_INTENTOS = 5;
const BACKOFF_TOPE_MIN = 60;

export function minutosParaSiguienteIntento(intentos: number): number {
  return Math.min(2 ** Math.max(intentos, 1), BACKOFF_TOPE_MIN);
}

export function agotoIntentos(intentos: number): boolean {
  return intentos >= MAX_INTENTOS;
}
