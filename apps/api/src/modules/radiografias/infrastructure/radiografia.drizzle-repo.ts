import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../../db/drizzle';
import type {
  NewRadiografiaInput,
  RadiografiaRepository,
  RadiografiaRow,
} from '../domain/radiografia.repository';

interface Row {
  id: string;
  patient_id: string;
  storage_key: string;
  mime_type: string;
  subido_por_nombre: string;
  created_at: Date;
}

function toRow(r: Row): RadiografiaRow {
  return {
    id: r.id,
    patientId: r.patient_id,
    storageKey: r.storage_key,
    mimeType: r.mime_type,
    subidoPorNombre: r.subido_por_nombre,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

@Injectable()
export class DrizzleRadiografiaRepository implements RadiografiaRepository {
  async crear(tx: Tx, input: NewRadiografiaInput): Promise<RadiografiaRow> {
    const result = await tx.execute(sql`
      INSERT INTO radiografias (patient_id, storage_key, mime_type, subido_por)
      VALUES (${input.patientId}, ${input.storageKey}, ${input.mimeType}, ${input.subidoPor})
      RETURNING id, patient_id, storage_key, mime_type,
                (SELECT nombre FROM users WHERE id = ${input.subidoPor}) AS subido_por_nombre,
                created_at
    `);
    return toRow((result.rows as unknown as Row[])[0]!);
  }

  async listarPorPaciente(tx: Tx, patientId: string): Promise<RadiografiaRow[]> {
    const result = await tx.execute(sql`
      SELECT r.id, r.patient_id, r.storage_key, r.mime_type, u.nombre AS subido_por_nombre, r.created_at
        FROM radiografias r
        JOIN users u ON u.id = r.subido_por
       WHERE r.patient_id = ${patientId}
       ORDER BY r.created_at DESC
    `);
    return (result.rows as unknown as Row[]).map(toRow);
  }

  async eliminar(tx: Tx, id: string): Promise<RadiografiaRow | null> {
    const result = await tx.execute(sql`
      DELETE FROM radiografias r
      USING users u
      WHERE r.id = ${id} AND u.id = r.subido_por
      RETURNING r.id, r.patient_id, r.storage_key, r.mime_type, u.nombre AS subido_por_nombre, r.created_at
    `);
    const row = (result.rows as unknown as Row[])[0];
    return row ? toRow(row) : null;
  }
}
