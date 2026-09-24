import type { ActividadClinicaPaciente } from '@healthflow/shared-types';
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

/**
 * No se puede borrar un paciente que tiene actividad clínica.
 *
 * No es una restricción técnica: la NOM-004-SSA3-2012 obliga a conservar el
 * expediente al menos cinco años desde el último acto médico, y los Términos y
 * Condiciones del servicio (cláusula 10.4) trasladan esa obligación al
 * cliente. Borrarlo además dispararía los ON DELETE CASCADE de nueve tablas,
 * incluidas `consentimientos` y `recetas`, que existen precisamente para no
 * poder borrarse.
 *
 * El camino correcto para "ya no quiero ver a este paciente" es ARCHIVARLO, y
 * el mensaje lo dice para que no se lea como un fallo del sistema.
 */
export class PacienteConHistorialClinicoError extends DomainError {
  readonly code = 'PacienteConHistorialClinico';
  readonly httpStatus = 409; // Conflict

  constructor(readonly actividad: ActividadClinicaPaciente) {
    super(
      'Este paciente tiene expediente clínico y no se puede eliminar: ' +
        resumir(actividad) +
        '. La NOM-004 obliga a conservarlo al menos cinco años desde el último acto médico. ' +
        'Si ya no lo atiendes, archívalo: desaparece de las búsquedas y el expediente se conserva.',
    );
  }

  override details(): Record<string, unknown> {
    return { actividad: this.actividad };
  }
}

/** Singular y plural por separado: "1 recetas" delata que nadie leyó el mensaje. */
const ETIQUETAS: Record<keyof ActividadClinicaPaciente, [string, string]> = {
  notas: ['nota clínica', 'notas clínicas'],
  recetas: ['receta', 'recetas'],
  consentimientos: ['consentimiento', 'consentimientos'],
  radiografias: ['radiografía', 'radiografías'],
  presupuestos: ['presupuesto', 'presupuestos'],
  facturas: ['factura', 'facturas'],
  ordenesPlantillas: ['orden de plantillas', 'órdenes de plantillas'],
  citasAtendidas: ['cita atendida', 'citas atendidas'],
  datosFiscales: ['receptor fiscal registrado', 'receptores fiscales registrados'],
};

function resumir(actividad: ActividadClinicaPaciente): string {
  return (Object.keys(ETIQUETAS) as (keyof ActividadClinicaPaciente)[])
    .filter((k) => actividad[k] > 0)
    .map((k) => `${actividad[k]} ${ETIQUETAS[k][actividad[k] === 1 ? 0 : 1]}`)
    .join(', ');
}

/** El paciente no existe en la clínica activa (o RLS lo dejó invisible). */
export class PacienteNoEncontradoError extends DomainError {
  readonly code = 'PacienteNoEncontrado';
  readonly httpStatus = 404;

  constructor() {
    super('Paciente no encontrado');
  }
}

/** Un nombre vacío dejaría el expediente sin sujeto identificable. */
export class NombrePacienteInvalidoError extends DomainError {
  readonly code = 'NombrePacienteInvalido';
  readonly httpStatus = 422;

  constructor() {
    super('El nombre del paciente debe tener al menos 2 caracteres');
  }
}

/** No se puede elegir correo como canal si no hay una dirección válida. */
export class CanalCorreoSinEmailError extends DomainError {
  readonly code = 'CanalCorreoSinEmail';
  readonly httpStatus = 422;

  constructor() {
    super('Captura un correo válido para enviar avisos por email');
  }
}
