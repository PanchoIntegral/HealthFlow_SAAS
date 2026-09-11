import { DomainError } from '../errors/domain.error';
import type { FeatureFlag, RazonNoDisponible } from '@healthflow/shared-types';

/**
 * La clínica no puede usar este módulo ahora mismo (ADR 0004 §D3).
 *
 * 404 y no 403 a propósito: para esta clínica el módulo no existe todavía, y
 * un 403 sugeriría "existe, pero tu rol no alcanza" — que es otra cosa y
 * llevaría al usuario a pedirle permisos a su administrador en vez de
 * contratar o activar el módulo. El `code` estable permite al frontend ocultar
 * la navegación, y la `razon` decide el texto: "no incluido en tu plan" y
 * "actívalo en Ajustes" son conversaciones distintas.
 *
 * La razón SÍ viaja al cliente, a diferencia de los enlaces públicos: aquí el
 * usuario está autenticado y es su propia clínica — no hay nada que enumerar.
 *
 * Apagar o suspender nunca borra el histórico: el rollback deja los datos en
 * su lugar y sólo cierra la puerta.
 */
export class ModuloNoDisponibleError extends DomainError {
  readonly code = 'ModuloNoDisponible';
  readonly httpStatus = 404;

  constructor(
    readonly flag: FeatureFlag,
    readonly razon: RazonNoDisponible,
  ) {
    super(MENSAJES[razon]);
  }

  details(): Record<string, unknown> {
    return { flag: this.flag, razon: this.razon };
  }
}

const MENSAJES: Record<RazonNoDisponible, string> = {
  entitlement: 'Este módulo no está incluido en el plan de tu clínica.',
  suscripcion: 'Este módulo está en pausa mientras se regulariza el pago.',
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
