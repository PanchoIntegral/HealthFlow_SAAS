import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  EMPTY_NOTA_EVOLUCION,
  type ClinicalNoteType,
  type ClinicalNoteStatus,
  type ClinicalRecordView,
  type NotaEvolucionContent,
} from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import { ClinicalNote } from '../domain/clinical-note.entity';
import type {
  ClinicalRecordRepository,
  CreateDraftNoteInput,
} from '../domain/clinical-record.repository';

interface NoteRow {
  id: string;
  clinical_record_id: string;
  appointment_id: string;
  doctor_id: string;
  tipo_nota: ClinicalNoteType;
  estatus: ClinicalNoteStatus;
  contenido_nom004: NotaEvolucionContent;
  cerrado_en: Date | null;
  created_at: Date;
}

/**
 * Adaptador Drizzle/Postgres del expediente clínico. Corre sobre la transacción
 * con tenant fijado: RLS aísla las lecturas y el DEFAULT current_tenant_id()
 * rellena tenant_id en los inserts.
 */
@Injectable()
export class DrizzleClinicalRecordRepository implements ClinicalRecordRepository {
  async ensureRecordForPatient(tx: Tx, patientId: string): Promise<string> {
    const result = await tx.execute(sql`
      INSERT INTO clinical_records (patient_id)
      VALUES (${patientId})
      ON CONFLICT (patient_id) DO UPDATE SET patient_id = EXCLUDED.patient_id
      RETURNING id
    `);
    return (result.rows[0] as { id: string }).id;
  }

  async createDraftNote(tx: Tx, input: CreateDraftNoteInput): Promise<string> {
    const contenido = JSON.stringify(EMPTY_NOTA_EVOLUCION);
    const result = await tx.execute(sql`
      INSERT INTO clinical_notes (clinical_record_id, appointment_id, doctor_id, tipo_nota, contenido_nom004, estatus)
      VALUES (${input.clinicalRecordId}, ${input.appointmentId}, ${input.doctorId}, 'nota_evolucion', ${contenido}::jsonb, 'borrador')
      RETURNING id
    `);
    return (result.rows[0] as { id: string }).id;
  }

  async findNoteByAppointment(tx: Tx, appointmentId: string): Promise<ClinicalNote | null> {
    const result = await tx.execute(sql`
      SELECT id, clinical_record_id, appointment_id, doctor_id, tipo_nota,
             estatus, contenido_nom004, cerrado_en, created_at
        FROM clinical_notes
       WHERE appointment_id = ${appointmentId}
       LIMIT 1
    `);
    const row = (result.rows as unknown as NoteRow[])[0];
    if (!row) return null;
    return ClinicalNote.fromState({
      id: row.id,
      clinicalRecordId: row.clinical_record_id,
      appointmentId: row.appointment_id,
      doctorId: row.doctor_id,
      tipoNota: row.tipo_nota,
      estatus: row.estatus,
      contenido: row.contenido_nom004,
      cerradoEn: row.cerrado_en ? new Date(row.cerrado_en) : null,
    });
  }

  async saveNote(tx: Tx, note: ClinicalNote): Promise<void> {
    const s = note.toState();
    await tx.execute(sql`
      UPDATE clinical_notes
         SET contenido_nom004 = ${JSON.stringify(s.contenido)}::jsonb,
             estatus = ${s.estatus},
             cerrado_en = ${s.cerradoEn ? s.cerradoEn.toISOString() : null}
       WHERE id = ${s.id}
    `);
  }

  async getDoctorSignature(
    tx: Tx,
    doctorId: string,
  ): Promise<{ nombre: string; cedula: string | null }> {
    const result = await tx.execute(sql`
      SELECT nombre, cedula_profesional AS cedula FROM users WHERE id = ${doctorId} LIMIT 1
    `);
    const row = (result.rows as unknown as { nombre: string; cedula: string | null }[])[0];
    return row ?? { nombre: 'Médico', cedula: null };
  }

  async getRecordView(tx: Tx, patientId: string): Promise<ClinicalRecordView | null> {
    const recordRes = await tx.execute(sql`
      SELECT cr.id AS record_id, cr.patient_id, cr.abierto_en, p.nombre AS patient_nombre
        FROM clinical_records cr
        JOIN patients p ON p.id = cr.patient_id
       WHERE cr.patient_id = ${patientId}
       LIMIT 1
    `);
    const record = (
      recordRes.rows as unknown as {
        record_id: string;
        patient_id: string;
        abierto_en: Date;
        patient_nombre: string;
      }[]
    )[0];
    if (!record) return null;

    const notesRes = await tx.execute(sql`
      SELECT id, clinical_record_id, appointment_id, doctor_id, tipo_nota,
             estatus, contenido_nom004, cerrado_en, created_at
        FROM clinical_notes
       WHERE clinical_record_id = ${record.record_id}
       ORDER BY created_at DESC
    `);

    return {
      recordId: record.record_id,
      patientId: record.patient_id,
      patientNombre: record.patient_nombre,
      abiertoEn: new Date(record.abierto_en).toISOString(),
      notas: (notesRes.rows as unknown as NoteRow[]).map((row) => ({
        id: row.id,
        appointmentId: row.appointment_id,
        doctorId: row.doctor_id,
        tipoNota: row.tipo_nota,
        estatus: row.estatus,
        contenido: row.contenido_nom004,
        cerradoEn: row.cerrado_en ? new Date(row.cerrado_en).toISOString() : null,
        createdAt: new Date(row.created_at).toISOString(),
      })),
    };
  }
}
