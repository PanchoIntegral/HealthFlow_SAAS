import { DomainError } from '../errors/domain.error';
import type { SubscriptionStatus } from './subscription-status';

/**
 * La suscripción está vencida y la cuenta quedó en solo lectura: se puede
 * consultar el expediente de un paciente, pero no escribir nada nuevo.
 *
 * 402 Payment Required por el mismo criterio que LimitePlanAlcanzadoError
 * (ver common/plan/plan.errors.ts): no es que al usuario le falten permisos
 * —los tiene—, es que la cuenta debe dinero. El frontend distingue el 402
 * del 403 para ofrecer reactivar el pago en vez de un "no tienes acceso".
 *
 * Deliberadamente NO se bloquean las lecturas: cortarle a un médico el acceso
 * al expediente de sus pacientes por un tema de cobranza es un riesgo clínico
 * y legal que no compensa la presión de cobro.
 */
export class SuscripcionSuspendidaError extends DomainError {
  readonly code = 'SuscripcionSuspendida';
  readonly httpStatus = 402;

  constructor(
    readonly subscriptionStatus: SubscriptionStatus,
    readonly graceUntil: Date | null,
  ) {
    super(
      'Tu suscripción está vencida. Puedes seguir consultando la información ' +
        'de tus pacientes, pero para volver a registrar cambios necesitas ' +
        'regularizar el pago.',
    );
  }

  details(): Record<string, unknown> {
    return {
      subscriptionStatus: this.subscriptionStatus,
      graceUntil: this.graceUntil?.toISOString() ?? null,
      soloLectura: true,
    };
  }
}
