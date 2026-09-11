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

export type Capacidad =
  | { disponible: true }
  | { disponible: false; razon: RazonNoDisponible };

/**
 * El ORDEN de las comprobaciones es la parte importante, porque determina el
 * mensaje que ve el usuario:
 *
 *  1. entitlement — "no está incluido en tu plan" es una conversación de
 *     ventas y va primero: a quien no contrató el módulo no le sirve saber
 *     que además su suscripción venció;
 *  2. suscripción — "regulariza el pago";
 *  3. rollout     — "no disponible por ahora" (lo apagamos nosotros);
 *  4. configuración — "actívalo en Ajustes" (lo apagó el titular).
 *
 * Un entitlement `suspended` o vencido cuenta como no contratado: suspender
 * bloquea el uso, pero jamás borra el histórico (eso vive en la tabla).
 */
export function capacidadEfectiva(entrada: EntradaCapacidad, ahora: Date): Capacidad {
  if (!tieneDerechoVigente(entrada.entitlement, ahora)) {
    return { disponible: false, razon: 'entitlement' };
  }
  if (!entrada.suscripcionVigente) return { disponible: false, razon: 'suscripcion' };
  if (!entrada.rollout) return { disponible: false, razon: 'rollout' };
  if (!entrada.configuracion) return { disponible: false, razon: 'configuracion' };
  return { disponible: true };
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

/**
 * Qué hace cada punto de aplicación con una razón.
 *
 * `suscripcion` es el caso especial y está así a propósito: en HTTP la maneja
 * SuscripcionInterceptor, que bloquea ESCRITURAS con 402 y deja pasar las
 * lecturas — cortarle a un médico el acceso al expediente por cobranza es un
 * riesgo clínico. Pero el worker sí se detiene: no se le manda un mensaje al
 * paciente de una clínica que dejó de pagar.
 */
export function bloqueaLecturaHttp(razon: RazonNoDisponible): boolean {
  return razon !== 'suscripcion';
}

/** Módulos que este archivo gobierna. Alias legible para las firmas. */
export type ModuloKey = FeatureFlag;
