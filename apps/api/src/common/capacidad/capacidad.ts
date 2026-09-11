import type { EstadoEntitlement, FeatureFlag, RazonNoDisponible } from '@healthflow/shared-types';

/**
 * Única fuente de verdad sobre si una clínica puede usar un módulo.
 *
 * Módulo PURO: recibe el reloj, no lo consulta; sin Nest, sin SQL. Los tres
 * puntos que lo aplican —interceptor HTTP, casos de uso y despachador de
 * eventos— llaman a esta función en vez de reimplementar la regla. Que el
 * worker y la API decidan distinto sobre el mismo módulo es exactamente el
 * bug que esto existe para evitar.
 */

export interface EntradaCapacidad {
  /** Estado de cobro de la clínica, ya resuelto por la capa de suscripción. */
  suscripcionVigente: boolean;
  /** Derecho contratado: del plan, de un add-on, de una prueba o manual. */
  entitlement: { estado: EstadoEntitlement; vigenciaHasta: Date | null } | null;
  /** Interruptor de operación de HealthFlow. `true` salvo rollback. */
  rollout: boolean;
  /** El titular decidió usarlo. */
  configuracion: boolean;
}

/**
 * Leer y escribir NO son la misma pregunta.
 *
 * Un módulo sin contratar, en rollback o sin activar desaparece entero: no hay
 * nada que consultar. Pero una clínica que se atrasó en el pago conserva la
 * lectura y pierde la escritura — es la misma decisión que ya gobierna el
 * expediente clínico, y por el mismo motivo: cortarle a un médico el acceso a
 * la información de sus pacientes por un tema de cobranza es un riesgo clínico
 * y legal que no compensa la presión de cobro.
 */
export type ModoAcceso = 'lectura' | 'escritura';

export type Capacidad =
  | { acceso: 'completo' }
  /** Se puede consultar lo que ya existe, pero no producir nada nuevo. */
  | { acceso: 'solo_lectura'; razon: RazonNoDisponible }
  /** El módulo no existe para esta clínica. */
  | { acceso: 'ninguno'; razon: RazonNoDisponible };

/**
 * El ORDEN de las comprobaciones determina el mensaje que ve el usuario:
 *
 *  1. entitlement — "no está incluido en tu plan" es una conversación de
 *     ventas y va primero: a quien no contrató el módulo no le sirve saber
 *     que además su suscripción venció;
 *  2. rollout     — "no disponible por ahora" (lo apagamos nosotros);
 *  3. configuración — "actívalo en Ajustes" (lo apagó el titular);
 *  4. suscripción — degrada a solo lectura, no oculta.
 *
 * La suscripción va al FINAL justamente porque es la única que no oculta: si
 * fuera antes, una clínica sin contratar el módulo y con un pago atrasado
 * vería "regulariza tu pago" para algo que de todos modos no compró.
 *
 * Un entitlement `suspended` o vencido cuenta como no contratado: suspender
 * bloquea el uso, pero jamás borra el histórico (eso vive en la tabla).
 */
export function capacidadEfectiva(entrada: EntradaCapacidad, ahora: Date): Capacidad {
  if (!tieneDerechoVigente(entrada.entitlement, ahora)) {
    return { acceso: 'ninguno', razon: 'entitlement' };
  }
  if (!entrada.rollout) return { acceso: 'ninguno', razon: 'rollout' };
  if (!entrada.configuracion) return { acceso: 'ninguno', razon: 'configuracion' };
  if (!entrada.suscripcionVigente) return { acceso: 'solo_lectura', razon: 'suscripcion' };
  return { acceso: 'completo' };
}

/** ¿Este modo de acceso está permitido con esta capacidad? */
export function permite(capacidad: Capacidad, modo: ModoAcceso): boolean {
  if (capacidad.acceso === 'completo') return true;
  if (capacidad.acceso === 'ninguno') return false;
  return modo === 'lectura';
}

/** Para la vista y para `disponible` en las respuestas de la API. */
export function estaDisponible(capacidad: Capacidad): boolean {
  return capacidad.acceso === 'completo';
}

export function razonDe(capacidad: Capacidad): RazonNoDisponible | null {
  return capacidad.acceso === 'completo' ? null : capacidad.razon;
}

/**
 * ¿El derecho está vigente AHORA?
 *
 * Exportada para que la vista de Ajustes calcule su casilla "contratado" con
 * exactamente el mismo criterio que usa la decisión. Derivarla aparte fue un
 * bug: un derecho `suspended` se mostraba como contratado mientras la
 * capacidad efectiva ya lo negaba, y la pantalla decía una cosa y la API otra.
 */
export function tieneDerechoVigente(
  entitlement: EntradaCapacidad['entitlement'],
  ahora: Date,
): boolean {
  if (entitlement === null) return false;
  if (entitlement.estado !== 'active' && entitlement.estado !== 'trialing') return false;
  return entitlement.vigenciaHasta === null || entitlement.vigenciaHasta.getTime() > ahora.getTime();
}

/** Módulos que este archivo gobierna. Alias legible para las firmas. */
export type ModuloKey = FeatureFlag;
