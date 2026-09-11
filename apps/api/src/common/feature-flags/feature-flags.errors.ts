import { DomainError } from '../errors/domain.error';
import type { FeatureFlag } from '@healthflow/shared-types';

/**
 * El módulo existe en el código pero esta clínica todavía no lo tiene
 * liberado (§5.8: liberación por etapas y rollback por tenant).
 *
 * 404 y no 403 a propósito: para esta clínica el módulo no existe todavía, y
 * un 403 sugeriría "existe, pero tu rol no alcanza" — que es otra cosa y
 * llevaría al usuario a pedirle permisos a su administrador en vez de
 * contratar/activar el módulo. El `code` estable permite al frontend ocultar
 * la navegación y mostrar el aviso correcto sin adivinar por el status.
 *
 * Apagar el flag NO borra ni oculta el histórico para el administrador: el
 * rollback deja los datos en su lugar (misma regla que §5.8).
 */
export class ModuloNoDisponibleError extends DomainError {
  readonly code = 'ModuloNoDisponible';
  readonly httpStatus = 404;

  constructor(readonly flag: FeatureFlag) {
    super('Este módulo no está activado en tu clínica.');
  }

  details(): Record<string, unknown> {
    return { flag: this.flag };
  }
}

/** Nombre de flag que no está en el catálogo de shared-types. */
export class FlagDesconocidoError extends DomainError {
  readonly code = 'FlagDesconocido';
  readonly httpStatus = 422;

  constructor(readonly valor: string) {
    super(`'${valor}' no es un módulo conocido.`);
  }
}
