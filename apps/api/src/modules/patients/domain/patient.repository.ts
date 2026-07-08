import type { PatientSummary } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import type { Patient } from './patient.entity';

/**
 * Puerto del repositorio de pacientes. Todos los métodos reciben la transacción
 * con el tenant fijado, por lo que RLS garantiza el aislamiento por clínica.
 */
export interface PatientRepository {
  /** Inserta y devuelve el id generado. */
  create(tx: Tx, patient: Patient): Promise<string>;

  /** ¿Existe ya un paciente con esa CURP en el tenant activo? */
  existsByCurp(tx: Tx, curp: string): Promise<boolean>;

  /** Búsqueda por nombre o CURP (prefijo, case-insensitive). Limitada. */
  search(tx: Tx, query: string, limit: number): Promise<PatientSummary[]>;
}

export const PATIENT_REPOSITORY = Symbol('PATIENT_REPOSITORY');
