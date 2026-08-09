import { DomainError } from '../../../common/errors/domain.error';

/**
 * La clínica no tiene cliente en Stripe, así que no hay portal de facturación
 * que abrir. Pasa con las cuentas anteriores al self-serve y las de
 * desarrollo: existen en la base pero nunca pasaron por un checkout.
 *
 * 409 y no 404: el recurso "portal" no es que no exista, es que esta cuenta
 * está en un estado que no lo admite. El frontend lo traduce a "contacta a
 * soporte para gestionar tu plan".
 */
export class SinClienteDeStripeError extends DomainError {
  readonly code = 'SinClienteDeStripe';
  readonly httpStatus = 409;

  constructor() {
    super(
      'Esta cuenta no tiene una suscripción gestionada por Stripe. ' +
        'Escríbenos para gestionar tu plan.',
    );
  }
}
