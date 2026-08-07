import type { EstadoSuscripcion, SubscriptionStatus } from './subscription-status';

/**
 * ¿La clínica está en modo solo lectura por no haber pagado?
 *
 * Es una función PURA que se evalúa en cada escritura a partir del estado
 * actual en la base. Esa es la decisión de diseño importante: el "suspendido"
 * no se almacena en ninguna columna, se DERIVA. La consecuencia es que la
 * reanudación no necesita lógica propia — en cuanto el webhook de Stripe
 * devuelve el status a 'active', esta función deja de restringir y el acceso
 * vuelve solo, sin reiniciar la API ni volver a iniciar sesión.
 */
export function debeRestringir(estado: EstadoSuscripcion, ahora: Date): boolean {
  switch (estado.status) {
    // Todo en orden: pagando, en periodo de prueba, o un primer cobro que
    // Stripe aún está confirmando ('incomplete' dura minutos — cortar el
    // acceso ahí castigaría a alguien que acaba de pagar).
    case 'active':
    case 'trialing':
    case 'incomplete':
      return false;

    // Nunca pasó por Stripe: seeds, desarrollo y cuentas anteriores al
    // self-serve. No hay nada que cobrar, así que no hay nada que restringir.
    case 'none':
      return false;

    // Un cobro falló y corre el reloj de la gracia.
    case 'past_due':
      // Sin fecha de gracia no se restringe: significa que el webhook de
      // invoice.payment_failed se perdió y no sabemos desde cuándo debe. Es
      // un fail-open deliberado — ante la duda, no le cortamos el acceso a
      // una clínica que quizá sí pagó; el job de reconciliación la rellena.
      if (estado.graceUntil === null) return false;
      return ahora.getTime() > estado.graceUntil.getTime();

    // Se acabaron los reintentos, la canceló, el trial expiró sin tarjeta
    // válida, o está pausada. Aquí ya no hay nada que esperar.
    case 'unpaid':
    case 'canceled':
    case 'incomplete_expired':
    case 'paused':
      return true;
  }
}

/**
 * Cuánto dura la gracia tras un cobro fallido, para quien YA había pagado
 * antes. Stripe reintenta el cobro unas 3-4 veces en esta ventana, así que
 * cubre el caso normal (tarjeta vencida, fondos insuficientes) sin suspender
 * a alguien que sí iba a pagar.
 */
export const DIAS_DE_GRACIA = 7;

/**
 * ¿Este tenant merece los días de gracia?
 *
 * Solo si ya había pagado alguna vez. Quien llega a `past_due` desde el trial
 * sin haber pagado nunca no la recibe: el trial de 14 días más 7 de gracia
 * serían 21 días gratis para alguien que jamás puso una tarjeta válida.
 */
export function diasDeGracia(ultimoPagoAt: Date | null): number {
  return ultimoPagoAt === null ? 0 : DIAS_DE_GRACIA;
}

/** Los estados que la UI debe mostrar como "hay un problema con tu pago". */
export function requiereAtencion(status: SubscriptionStatus): boolean {
  return status === 'past_due' || status === 'unpaid' || status === 'incomplete';
}

/**
 * Qué tan grave es la situación de pago, para la UI.
 *
 * Existe porque el 402 llega DEMASIADO TARDE: solo se dispara cuando la cuenta
 * ya quedó en solo lectura, es decir con la gracia agotada. Durante esos 7 días
 * el usuario no se enteraba de nada y un buen día dejaba de poder guardar. La
 * cláusula 5.3 de los términos además promete avisar con anticipación, así que
 * el aviso previo no es solo cortesía.
 *
 * Se deriva aquí, junto a `debeRestringir`, y no en el cliente: si el frontend
 * reimplementara el umbral, las dos definiciones de "suspendida" se separarían
 * al primer cambio de política y el banner mentiría.
 */
export type AvisoSuscripcion = 'ok' | 'advertencia' | 'suspendida';

export function avisoSuscripcion(estado: EstadoSuscripcion, ahora: Date): AvisoSuscripcion {
  if (debeRestringir(estado, ahora)) return 'suspendida';
  return requiereAtencion(estado.status) ? 'advertencia' : 'ok';
}
