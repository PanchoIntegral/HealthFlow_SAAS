import { DomainError } from '../../../common/errors/domain.error';

/** Falta procedimiento o contenido: no hay nada que registrar. */
export class ConsentimientoInvalidoError extends DomainError {
  readonly code = 'ConsentimientoInvalido';
  readonly httpStatus = 422;

  constructor(message: string) {
    super(message);
  }
}

export class ConsentimientoNoEncontradoError extends DomainError {
  readonly code = 'ConsentimientoNoEncontrado';
  readonly httpStatus = 404;

  constructor() {
    super('Consentimiento no encontrado');
  }
}
