import { DomainError } from '../../../common/errors/domain.error';

/** Se intentó modificar/cerrar una nota clínica ya cerrada (inmutable, NOM-004). */
export class NoteAlreadyClosedError extends DomainError {
  readonly code = 'NoteAlreadyClosed';
  readonly httpStatus = 409; // Conflict

  constructor() {
    super('La nota clínica ya está cerrada y es inmutable');
  }
}

/**
 * No se puede cerrar la nota: faltan campos obligatorios. Pueden venir de la
 * base NOM-004 o de la especialidad (p.ej. NOM-013 para odontología), así que
 * el mensaje ya no cita una norma concreta — citar la equivocada confunde más
 * que no citar ninguna.
 */
export class IncompleteClinicalNoteError extends DomainError {
  readonly code = 'IncompleteClinicalNote';
  readonly httpStatus = 422; // Unprocessable Entity

  constructor(readonly missing: string[]) {
    super(`Faltan campos obligatorios para cerrar la nota: ${missing.join(', ')}`);
  }

  override details(): Record<string, unknown> {
    return { missing: this.missing };
  }
}
