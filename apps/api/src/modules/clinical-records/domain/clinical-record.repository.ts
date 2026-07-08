import type { ClinicalRecordView } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import type { ClinicalNote } from './clinical-note.entity';

export interface CreateDraftNoteInput {
  clinicalRecordId: string;
  appointmentId: string;
  doctorId: string;
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

  findNoteByAppointment(tx: Tx, appointmentId: string): Promise<ClinicalNote | null>;
  saveNote(tx: Tx, note: ClinicalNote): Promise<void>;

  /** Datos de firma del médico (para estampar al cerrar la nota). */
  getDoctorSignature(tx: Tx, doctorId: string): Promise<{ nombre: string; cedula: string | null }>;

  /** Expediente completo (record + notas) de un paciente para la vista del médico. */
  getRecordView(tx: Tx, patientId: string): Promise<ClinicalRecordView | null>;
}

export const CLINICAL_RECORD_REPOSITORY = Symbol('CLINICAL_RECORD_REPOSITORY');
