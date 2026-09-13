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
 * No se puede firmar: al médico le falta nombre o cédula profesional.
 *
 * Antes se estampaba "Médico" con cédula nula como respaldo. Una nota firmada
 * por nadie identificable no sirve como documento médico-legal, y descubrirlo
 * al revisar el expediente años después es tarde: se exige al cerrar.
 */
export class FirmaIncompletaError extends DomainError {
  readonly code = 'FirmaIncompleta';
  readonly httpStatus = 422;

  constructor(readonly faltantes: ('medicoNombre' | 'cedula')[]) {
    super('Registra tu nombre y cédula profesional en tu perfil para poder firmar la nota');
  }

  override details(): Record<string, unknown> {
    return { faltantes: this.faltantes };
  }
}

/**
 * Sólo el médico al que pertenece la nota puede firmarla. La firma estampa
 * los datos de quien cierra: si cerrara otro, la nota diría un autor en
 * `doctor_id` y otro distinto en la firma.
 */
export class NotaDeOtroMedicoError extends DomainError {
  readonly code = 'NotaDeOtroMedico';
  readonly httpStatus = 403;

  constructor() {
    super('Sólo el médico que atiende la consulta puede firmar esta nota');
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
