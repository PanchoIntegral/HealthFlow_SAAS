/**
 * Los estados que Stripe puede poner en `tenants.subscription_status`, más
 * 'none' para los tenants que nunca pasaron por Stripe (seeds, desarrollo y
 * las cuentas anteriores al self-serve).
 *
 * La lista tiene que coincidir con el CHECK de la tabla (0020): si Stripe
 * introduce un estado nuevo, el UPDATE del webhook falla y hay que agregarlo
 * en ambos lados a la vez.
 */
export const SUBSCRIPTION_STATUSES = [
  'none',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused',
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export function esSubscriptionStatus(value: string): value is SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

/** Estado de la suscripción de un tenant, tal como lo lee el gating. */
export interface EstadoSuscripcion {
  status: SubscriptionStatus;
  graceUntil: Date | null;
}

/**
 * Lo mismo más la fecha de renovación, que el gating NO usa pero la UI sí
 * ("tu plan se renueva el …"). Se mantiene aparte para que la firma de
 * `debeRestringir` siga pidiendo únicamente lo que de verdad decide.
 */
export interface EstadoSuscripcionDetallado extends EstadoSuscripcion {
  currentPeriodEnd: Date | null;
}
