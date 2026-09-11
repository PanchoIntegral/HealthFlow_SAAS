/**
 * Aritmética de fechas LOCALES de la clínica (§9: "fechas y envíos usan la
 * zona horaria IANA de la clínica").
 *
 * Un vencimiento de recall es una fecha de calendario, no un instante: "vence
 * en marzo" significa lo mismo a las 8 de la mañana que a las 8 de la noche.
 * Guardarlo como `timestamptz` haría que un control creado a las 23:00 en
 * Tijuana venciera un día distinto que uno creado a las 10:00, por el desfase
 * con UTC. De ahí que la columna sea `date` y que estas funciones trabajen
 * sobre cadenas `YYYY-MM-DD`.
 *
 * Módulo PURO: ninguna función consulta el reloj.
 */

/** `YYYY-MM-DD` en la zona de la clínica, para un instante dado. */
export function fechaLocal(instante: Date, timezone: string): string {
  // `en-CA` produce exactamente YYYY-MM-DD, que es justo el formato que
  // PostgreSQL acepta para `date` sin ambigüedad de orden día/mes.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante);
}

/**
 * Suma meses a una fecha local, recortando al último día del mes cuando el día
 * no existe: 31 de enero + 1 mes = 28 (o 29) de febrero, no el 3 de marzo.
 *
 * El recorte importa de verdad: una limpieza del 31 de agosto con control
 * semestral debe vencer el 28 de febrero, y con la aritmética ingenua de
 * `Date` se iría al 2 o 3 de marzo — un par de días que en un recall no hacen
 * daño, pero que convierten la fecha en algo que el odontólogo no puede
 * predecir ni explicar.
 */
export function sumarMeses(fecha: string, meses: number): string {
  const [anio, mes, dia] = partes(fecha);
  const totalMeses = (anio * 12 + (mes - 1)) + meses;
  const anioDestino = Math.floor(totalMeses / 12);
  const mesDestino = (totalMeses % 12) + 1;
  const diaDestino = Math.min(dia, diasDelMes(anioDestino, mesDestino));
  return `${String(anioDestino).padStart(4, '0')}-${String(mesDestino).padStart(2, '0')}-${String(diaDestino).padStart(2, '0')}`;
}

/** Suma (o resta, con negativos) días a una fecha local. */
export function sumarDias(fecha: string, dias: number): string {
  const [anio, mes, dia] = partes(fecha);
  const t = Date.UTC(anio, mes - 1, dia) + dias * 86_400_000;
  const d = new Date(t);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** `a <= b` sobre fechas locales. Comparar cadenas ISO ya ordena bien. */
export function noEsPosterior(a: string, b: string): boolean {
  return a <= b;
}

/** Días de diferencia (b − a). Positivo si `b` es posterior. */
export function diasEntre(a: string, b: string): number {
  const [aa, am, ad] = partes(a);
  const [ba, bm, bd] = partes(b);
  return Math.round((Date.UTC(ba, bm - 1, bd) - Date.UTC(aa, am - 1, ad)) / 86_400_000);
}

export function esFechaLocal(valor: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const [anio, mes, dia] = partes(valor);
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= diasDelMes(anio, mes);
}

function partes(fecha: string): [number, number, number] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new Error(`Fecha local inválida: '${fecha}' (se espera YYYY-MM-DD)`);
  }
  return [Number(fecha.slice(0, 4)), Number(fecha.slice(5, 7)), Number(fecha.slice(8, 10))];
}

function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}
