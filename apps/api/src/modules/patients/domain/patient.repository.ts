import type {
  ActividadClinicaPaciente,
  HistorialPaciente,
  PatientSummary,
  UpdateHistorialRequest,
} from '@healthflow/shared-types';
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

  /** Total de pacientes de la clínica — lo que consume el cupo del plan. */
  contarTodos(tx: Tx): Promise<number>;

  /** Búsqueda por nombre o CURP (prefijo, case-insensitive). Limitada. */
  search(tx: Tx, query: string, limit: number): Promise<PatientSummary[]>;

  /** Directorio completo del tenant, ordenado por nombre. Limitado. */
  list(tx: Tx, limit: number): Promise<PatientSummary[]>;

  /**
   * Reemplaza alergias y antecedentes. Devuelve el historial guardado, o null
   * si el paciente no existe en el tenant activo.
   */
  updateHistorial(
    tx: Tx,
    patientId: string,
    input: UpdateHistorialRequest,
  ): Promise<HistorialPaciente | null>;

  /**
   * Corrige nombre y/o teléfono. `undefined` = no se toca ese campo.
   * Devuelve null si el paciente no existe en el tenant activo.
   */
  actualizarDatos(
    tx: Tx,
    patientId: string,
    datos: { nombre?: string; telefono?: string | null },
  ): Promise<PatientSummary | null>;

  /** true si el paciente existe en el tenant activo. */
  existe(tx: Tx, patientId: string): Promise<boolean>;

  /** Nombre actual, para dejar constancia del valor anterior al corregirlo. */
  nombreActual(tx: Tx, patientId: string): Promise<string | null>;

  /**
   * Cuenta los actos médicos y documentos del paciente. Es lo que decide si
   * se puede borrar: cero en todo = nunca fue un expediente, fue un error de
   * captura.
   */
  contarActividadClinica(tx: Tx, patientId: string): Promise<ActividadClinicaPaciente>;

  /** Baja lógica. `null` en archivadoPor lo reactiva. */
  archivar(tx: Tx, patientId: string, archivadoPor: string | null): Promise<boolean>;

  /**
   * Borrado real. Solo debe llamarse tras comprobar que no hay actividad
   * clínica: la base lo permite (patients sí concede DELETE) y arrastraría en
   * cascada nueve tablas.
   */
  eliminar(tx: Tx, patientId: string): Promise<boolean>;
}

export const PATIENT_REPOSITORY = Symbol('PATIENT_REPOSITORY');
