import { DomainError } from '../../../common/errors/domain.error';

/** CURP con formato inválido (no cumple la estructura oficial de 18 caracteres). */
export class InvalidCurpError extends DomainError {
  readonly code = 'InvalidCurp';
  readonly httpStatus = 422; // Unprocessable Entity

  constructor(readonly curp: string) {
    super(`CURP inválida: ${curp}`);
  }
}

/** Fecha de nacimiento inválida (vacía, no parseable o en el futuro). */
export class InvalidBirthDateError extends DomainError {
  readonly code = 'InvalidBirthDate';
  readonly httpStatus = 422;

  constructor(readonly value: string) {
    super(`Fecha de nacimiento inválida: ${value}`);
  }
}

/** Ya existe un paciente con esa CURP en la clínica. */
export class DuplicateCurpError extends DomainError {
  readonly code = 'DuplicateCurp';
  readonly httpStatus = 409; // Conflict

  constructor(readonly curp: string) {
    super(`Ya existe un paciente con la CURP ${curp} en esta clínica`);
  }
}
