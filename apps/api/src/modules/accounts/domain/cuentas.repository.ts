import type { CuentaView, EspecialidadKey, RolAsignable } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';

/** Datos ya validados de una cuenta nueva (la contraseña llega YA hasheada). */
export interface NuevaCuenta {
  nombre: string;
  email: string;
  passwordHash: string;
  rol: RolAsignable;
  /** true = aparece en la agenda como médico que atiende. */
  esMedico: boolean;
  cedulaProfesional: string | null;
  especialidad: string | null;
  especialidadKey: EspecialidadKey;
  creadoPor: string;
  medicoTitularId: string | null;
}

/** Cuántas cuentas ACTIVAS de cada tipo hay — es lo que consume cupo del plan. */
export interface ConteoCuentas {
  medicos: number;
  asistentes: number;
}

/**
 * Puerto del repositorio de cuentas del equipo. Todos los métodos reciben la
 * transacción con el tenant fijado: RLS impide leer o tocar usuarios de otra
 * clínica aunque llegue un id ajeno por la URL.
 */
export interface CuentasRepository {
  /** Todas las cuentas del consultorio, activas e inactivas, por nombre. */
  list(tx: Tx): Promise<CuentaView[]>;

  /** Cuentas activas por tipo. El titular ('admin' que atiende) cuenta como médico. */
  contarActivas(tx: Tx): Promise<ConteoCuentas>;

  existeEmail(tx: Tx, email: string): Promise<boolean>;

  create(tx: Tx, cuenta: NuevaCuenta): Promise<CuentaView>;

  getById(tx: Tx, id: string): Promise<CuentaView | null>;

  /** ¿Ese id es un médico ACTIVO de esta clínica (para ligarle un asistente)? */
  esMedicoActivo(tx: Tx, id: string): Promise<boolean>;

  /** Devuelve la cuenta ya actualizada, o null si no existe en el tenant. */
  setActivo(tx: Tx, id: string, activo: boolean): Promise<CuentaView | null>;
}

export const CUENTAS_REPOSITORY = Symbol('CUENTAS_REPOSITORY');
