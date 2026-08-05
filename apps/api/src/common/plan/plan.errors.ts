import { DomainError } from '../errors/domain.error';

/**
 * El plan contratado no da para más: se acabaron los asientos de médico, los
 * de asistente o el cupo de pacientes.
 *
 * 402 Payment Required y no 403: no es que al usuario le falten permisos —los
 * tiene—, es que la operación necesita un plan mayor. El frontend distingue
 * ese caso para ofrecer la mejora de plan en vez de un "no tienes acceso".
 */
export class LimitePlanAlcanzadoError extends DomainError {
  readonly code = 'LimitePlanAlcanzado';
  readonly httpStatus = 402;

  constructor(
    readonly recurso: 'medicos' | 'asistentes' | 'pacientes',
    readonly limite: number,
    readonly plan: string,
  ) {
    super(
      recurso === 'pacientes'
        ? `Tu plan ${plan} incluye hasta ${limite} pacientes. Mejora tu plan para registrar más.`
        : `Tu plan ${plan} incluye ${limite} ${recurso === 'medicos' ? (limite === 1 ? 'médico' : 'médicos') : limite === 1 ? 'asistente' : 'asistentes'}. Mejora tu plan para agregar más cuentas.`,
    );
  }

  details(): Record<string, unknown> {
    return { recurso: this.recurso, limite: this.limite, plan: this.plan };
  }
}
