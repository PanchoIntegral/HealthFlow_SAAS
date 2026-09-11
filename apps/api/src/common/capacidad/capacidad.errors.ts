import { DomainError } from '../errors/domain.error';
import type { FeatureFlag, RazonNoDisponible } from '@healthflow/shared-types';

/**
 * La clínica no puede hacer esto con este módulo (ADR 0004 §D3).
 *
 * El status depende de la RAZÓN, y esa es la parte con criterio:
 *
 *  - 402 cuando el problema es la suscripción. No es que el módulo no exista:
 *    es que hay que pagar. El frontend ya distingue el 402 para ofrecer
 *    reactivar el cobro, igual que con SuscripcionSuspendidaError.
 *  - 404 en los demás casos. Un 403 sugeriría "existe, pero tu rol no
 *    alcanza" —que es otra cosa— y mandaría al usuario a pedirle permisos a
 *    su administrador en vez de contratar o activar el módulo.
 *
 * La razón SÍ viaja al cliente, a diferencia de los enlaces públicos: aquí el
 * usuario está autenticado y es su propia clínica — no hay nada que enumerar.
 *
 * Apagar o suspender nunca borra el histórico: el rollback deja los datos en
 * su lugar y sólo cierra la puerta.
 */
export class ModuloNoDisponibleError extends DomainError {
  readonly code = 'ModuloNoDisponible';
  readonly httpStatus: number;

  constructor(
    readonly flag: FeatureFlag,
    readonly razon: RazonNoDisponible,
  ) {
    super(MENSAJES[razon]);
    this.httpStatus = razon === 'suscripcion' ? 402 : 404;
  }

  details(): Record<string, unknown> {
    return { flag: this.flag, razon: this.razon };
  }
}

const MENSAJES: Record<RazonNoDisponible, string> = {
  entitlement: 'Este módulo no está incluido en el plan de tu clínica.',
  suscripcion:
    'Puedes seguir consultando este módulo, pero para registrar cambios necesitas regularizar el pago.',
  rollout: 'Este módulo no está disponible por ahora.',
  configuracion: 'Este módulo no está activado en tu clínica.',
};

/** Nombre de módulo que no está en el catálogo de shared-types. */
export class ModuloDesconocidoError extends DomainError {
  readonly code = 'ModuloDesconocido';
  readonly httpStatus = 422;

  constructor(readonly valor: string) {
    super(`'${valor}' no es un módulo conocido.`);
  }
}
