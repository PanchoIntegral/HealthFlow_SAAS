import { DomainError } from '../../../common/errors/domain.error';

/** Ya hay una cuenta con ese correo en ESTA clínica (UNIQUE(tenant_id, email)). */
export class EmailYaRegistradoError extends DomainError {
  readonly code = 'EmailYaRegistrado';
  readonly httpStatus = 409;

  constructor(readonly email: string) {
    super(`Ya existe una cuenta con el correo ${email} en tu consultorio.`);
  }
}

export class CuentaNoEncontradaError extends DomainError {
  readonly code = 'CuentaNoEncontrada';
  readonly httpStatus = 404;

  constructor(readonly cuentaId: string) {
    super('La cuenta no existe en tu consultorio.');
  }
}

/**
 * El titular no puede darse de baja a sí mismo: es el dueño de la suscripción
 * y quedaría un consultorio sin nadie que administre las cuentas — incluida la
 * suya, porque desactivado ya no podría entrar a reactivarse.
 */
export class NoSePuedeDesactivarAlTitularError extends DomainError {
  readonly code = 'NoSePuedeDesactivarAlTitular';
  readonly httpStatus = 409;

  constructor() {
    super('La cuenta del titular no se puede desactivar.');
  }
}

/** El asistente se ligó a un usuario que no es un médico activo del consultorio. */
export class MedicoTitularInvalidoError extends DomainError {
  readonly code = 'MedicoTitularInvalido';
  readonly httpStatus = 422;

  constructor(readonly medicoId: string) {
    super('El médico al que asiste esta cuenta no existe o no está activo.');
  }
}
