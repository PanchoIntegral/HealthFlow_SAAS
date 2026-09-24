import type {
  ActividadClinicaPaciente,
  BookingChannel,
  HistorialPaciente,
  PatientSummary,
  UpdateHistorialRequest,
} from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import type { Patient } from './patient.entity';

/**
 * Posición dentro del listado, que va ordenado por `(nombre, id)`. Se pagina por
 * keyset y no por OFFSET: con OFFSET la base tiene que recorrer y descartar las
 * filas anteriores, así que cada página cuesta más que la anterior; comparando
 * contra la última clave entregada, la página 20 cuesta lo mismo que la 1.
 *
 * El `id` no es decorativo: sin él el orden no es total y dos pacientes
 * homónimos harían que la página siguiente repitiera o saltara filas.
 */
export interface PatientCursor {
  nombre: string;
  id: string;
}

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

  /** Cuántos pacientes coinciden con la búsqueda, ignorando la paginación. */
  contarCoincidencias(tx: Tx, query: string): Promise<number>;

  /**
   * Búsqueda por nombre o CURP (prefijo, case-insensitive), una página.
   * `desde` es el último `(nombre, id)` ya entregado; null empieza por el principio.
   */
  search(tx: Tx, query: string, limit: number, desde: PatientCursor | null): Promise<PatientSummary[]>;

  /** Directorio del tenant ordenado por nombre, una página. Ver `search` para `desde`. */
  list(tx: Tx, limit: number, desde: PatientCursor | null): Promise<PatientSummary[]>;

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
   * Corrige identificación y canal de avisos. `undefined` = no se toca
   * ese campo. Devuelve null si el paciente no existe en el tenant activo.
   */
  actualizarDatos(
    tx: Tx,
    patientId: string,
    datos: { nombre?: string; telefono?: string | null; fechaNacimiento?: string; email?: string | null; canalPreferido?: BookingChannel },
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
