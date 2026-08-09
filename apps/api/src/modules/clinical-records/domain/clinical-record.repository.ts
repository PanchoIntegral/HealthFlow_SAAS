import type {
  ClinicalNoteType,
  ClinicalRecordView,
  EspecialidadKey,
  Odontograma,
} from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import type { ClinicalNote } from './clinical-note.entity';

export interface CreateDraftNoteInput {
  clinicalRecordId: string;
  appointmentId: string;
  doctorId: string;
  /** 'historia_clinica' si es la primera nota del expediente, si no 'nota_evolucion'. */
  tipoNota: ClinicalNoteType;
  /**
   * Se estampa en el contenido de la nota al crearla y ya no cambia. Si el
   * médico cambia de especialidad más adelante, sus notas anteriores deben
   * seguir mostrándose y validándose con la que tenían al firmarse.
   */
  especialidad: EspecialidadKey;
  /** Estado dental heredado de la última nota cerrada; ausente en la primera visita. */
  odontograma?: Odontograma;
}

/**
 * Puerto del repositorio del expediente clínico. Corre sobre la transacción
 * con tenant fijado (RLS). El dominio/aplicación dependen de esta interface,
 * no de Drizzle.
 */
export interface ClinicalRecordRepository {
  /** Devuelve el id del expediente del paciente, creándolo si es su primera consulta. */
  ensureRecordForPatient(tx: Tx, patientId: string): Promise<string>;

  /** Crea la nota borrador ligada a la cita y devuelve su id. */
  createDraftNote(tx: Tx, input: CreateDraftNoteInput): Promise<string>;

  /** True si el expediente ya tiene alguna nota (de cualquier tipo/estatus). */
  hasAnyNoteForRecord(tx: Tx, clinicalRecordId: string): Promise<boolean>;

  findNoteByAppointment(tx: Tx, appointmentId: string): Promise<ClinicalNote | null>;
  saveNote(tx: Tx, note: ClinicalNote): Promise<void>;

  /** Datos de firma del médico (para estampar al cerrar la nota). */
  getDoctorSignature(tx: Tx, doctorId: string): Promise<{ nombre: string; cedula: string | null }>;

  /** Especialidad configurada del médico, para estampar la nota al abrirla. */
  getDoctorEspecialidad(tx: Tx, doctorId: string): Promise<EspecialidadKey>;

  /**
   * Odontograma de la última nota CERRADA del expediente, para arrastrar el
   * estado dental a la consulta nueva. null si no hay ninguna.
   */
  getUltimoOdontograma(tx: Tx, clinicalRecordId: string): Promise<Odontograma | null>;

  /**
   * Expediente de un paciente con UNA PÁGINA de su historial, de la nota más
   * reciente a la más antigua.
   *
   * Paginado y no completo: el historial de un paciente crónico crece sin
   * techo (conservación NOM-004), y traerlo entero en cada apertura es la
   * carga que peor envejece del sistema. El expediente sigue completo y
   * accesible — se recorre por páginas, no se recorta.
   */
  getRecordView(tx: Tx, patientId: string, page: PaginaNotas): Promise<ClinicalRecordView | null>;
}

/** Ventana del historial a devolver. `cursor` null = primera página. */
export interface PaginaNotas {
  limit: number;
  cursor: string | null;
}

export const CLINICAL_RECORD_REPOSITORY = Symbol('CLINICAL_RECORD_REPOSITORY');
