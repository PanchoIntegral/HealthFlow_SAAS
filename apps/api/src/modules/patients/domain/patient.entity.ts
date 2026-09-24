import { normalizeEmail, SEXOS_PACIENTE, type BookingChannel, type SexoPaciente } from '@healthflow/shared-types';
import { CanalCorreoSinEmailError, InvalidBirthDateError, InvalidCurpError } from './patient.errors';

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
  sexo?: SexoPaciente | null;
  curp?: string | null;
  telefono?: string | null;
  email?: string | null;
  canalPreferido?: BookingChannel;
}

export interface PatientProps {
  nombre: string;
  fechaNacimiento: string;
  /**
   * RIS art. 65: la receta lo exige. null = no se capturó, y es distinto de
   * 'no_especificado' (ver SEXOS_PACIENTE). No se deriva del CURP aunque éste
   * lo codifique en su séptimo carácter: no todo paciente tiene CURP y
   * adivinar un dato de identidad a partir de una cadena que el usuario pudo
   * teclear mal es peor que dejarlo vacío y pedirlo.
   */
  sexo: SexoPaciente | null;
  curp: string | null;
  telefono: string | null;
  email: string | null;
  canalPreferido: BookingChannel;
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
    const email = normalizeEmail(input.email);
    const canalPreferido = input.canalPreferido ?? 'ninguno';
    if (canalPreferido === 'email' && !email) {
      throw new CanalCorreoSinEmailError();
    }

    return new Patient({
      nombre,
      fechaNacimiento,
      sexo: normalizeSexo(input.sexo),
      curp,
      telefono: input.telefono?.trim() || null,
      email,
      canalPreferido,
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

/**
 * Un valor fuera del catálogo se descarta en vez de lanzar: el DTO ya lo
 * rechaza en el borde con @IsIn y la base tiene su CHECK, así que llegar aquí
 * con basura significa que algo interno se equivocó — y guardar null es más
 * seguro que guardar un sexo inventado en un expediente clínico.
 */
function normalizeSexo(sexo: SexoPaciente | null | undefined): SexoPaciente | null {
  return sexo && (SEXOS_PACIENTE as readonly string[]).includes(sexo) ? sexo : null;
}

function normalizeCurp(curp: string | null | undefined): string | null {
  const trimmed = curp?.trim().toUpperCase();
  return trimmed ? trimmed : null;
}

/**
 * Formato YYYY-MM-DD y no futura. Se usa al dar de alta y al corregir
 * (ActualizarPacienteUseCase) — misma regla, un solo lugar.
 */
export function normalizeBirthDate(value: string): string {
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
