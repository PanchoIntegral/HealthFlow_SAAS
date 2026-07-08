import { InvalidBirthDateError, InvalidCurpError } from './patient.errors';

/**
 * Estructura oficial de la CURP mexicana (18 caracteres):
 *   4 letras (nombre/apellidos) · 6 dígitos (AAMMDD) · sexo (H/M) ·
 *   2 letras (entidad) · 3 consonantes · 1 alfanumérico (homoclave) · 1 dígito.
 */
const CURP_REGEX =
  /^[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d$/;

export interface NewPatientInput {
  nombre: string;
  fechaNacimiento: string; // YYYY-MM-DD
  curp?: string | null;
  telefono?: string | null;
}

export interface PatientProps {
  nombre: string;
  fechaNacimiento: string;
  curp: string | null;
  telefono: string | null;
}

/**
 * Entidad de dominio Patient. Concentra las reglas de validación (CURP, fecha
 * de nacimiento) para que datos inválidos NUNCA lleguen a la base de datos —
 * y para que esas reglas sean testeables sin infraestructura.
 */
export class Patient {
  private constructor(private readonly props: PatientProps) {}

  /** Da de alta un paciente validando y normalizando la entrada. */
  static register(input: NewPatientInput): Patient {
    const nombre = input.nombre.trim(); // el DTO ya garantiza que no viene vacío

    const curp = normalizeCurp(input.curp);
    if (curp !== null && !CURP_REGEX.test(curp)) {
      throw new InvalidCurpError(curp);
    }

    const fechaNacimiento = normalizeBirthDate(input.fechaNacimiento);

    return new Patient({
      nombre,
      fechaNacimiento,
      curp,
      telefono: input.telefono?.trim() || null,
    });
  }

  get nombre(): string {
    return this.props.nombre;
  }
  get curp(): string | null {
    return this.props.curp;
  }

  static edad(fechaNacimiento: string, now: Date = new Date()): number {
    const dob = new Date(fechaNacimiento);
    let edad = now.getUTCFullYear() - dob.getUTCFullYear();
    const m = now.getUTCMonth() - dob.getUTCMonth();
    if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) edad--;
    return edad;
  }

  toProps(): PatientProps {
    return { ...this.props };
  }
}

function normalizeCurp(curp: string | null | undefined): string | null {
  const trimmed = curp?.trim().toUpperCase();
  return trimmed ? trimmed : null;
}

function normalizeBirthDate(value: string): string {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new InvalidBirthDateError(value);
  }
  const date = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.getTime() > Date.now()) {
    throw new InvalidBirthDateError(value);
  }
  return trimmed;
}
