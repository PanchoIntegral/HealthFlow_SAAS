/**
 * Base de todos los errores de DOMINIO. Sin dependencias de Nest/HTTP: el
 * dominio sigue siendo puro. Cada error declara su código y el status HTTP con
 * el que debe traducirse; el DomainExceptionFilter hace el mapeo en el borde.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;

  /** Datos extra a incluir en la respuesta (p.ej. from/to de una transición). */
  details(): Record<string, unknown> {
    return {};
  }

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
