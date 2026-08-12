import { normalizarE164Mx } from '@healthflow/shared-types';
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
  /** Casilla que el paciente marca. Sin ella no se le manda nada. */
  whatsappOptIn?: boolean;
}

export interface PatientProps {
  nombre: string;
  fechaNacimiento: string;
  curp: string | null;
  telefono: string | null;
  /** Celular normalizado; null si el capturado no es enviable. */
  telefonoE164: string | null;
  whatsappOptIn: boolean;
  whatsappOptInAt: Date | null;
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

    const telefono = input.telefono?.trim() || null;
    // El E.164 se DERIVA del teléfono capturado, no es un campo aparte que el
    // cliente pueda mandar por su cuenta: así no hay forma de que el número al
    // que se manda el WhatsApp difiera del que ve la clínica en la ficha.
    const telefonoE164 = normalizarE164Mx(telefono);

    // Consentimiento solo si además hay un número al que mandar: marcar la
    // casilla con un teléfono que WhatsApp rechaza no es un consentimiento
    // útil, y guardarlo haría creer que el paciente sí recibe avisos.
    const whatsappOptIn = Boolean(input.whatsappOptIn) && telefonoE164 !== null;

    return new Patient({
      nombre,
      fechaNacimiento,
      curp,
      telefono,
      telefonoE164,
      whatsappOptIn,
      // Fecha del consentimiento: la LFPDPPP exige poder acreditar cuándo se
      // otorgó, no solo que existe.
      whatsappOptInAt: whatsappOptIn ? new Date() : null,
    });
  }

  get nombre(): string {
    return this.props.nombre;
  }
  get curp(): string | null {
    return this.props.curp;
  }
  get telefonoE164(): string | null {
    return this.props.telefonoE164;
  }
  get whatsappOptIn(): boolean {
    return this.props.whatsappOptIn;
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
