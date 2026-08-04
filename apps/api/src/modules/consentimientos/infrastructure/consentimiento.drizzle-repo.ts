import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { ConsentimientoView } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import type { Consentimiento } from '../domain/consentimiento.entity';
import type { ConsentimientoRepository } from '../domain/consentimiento.repository';

interface ConsentimientoRow {
  id: string;
  patient_id: string;
  presupuesto_id: string | null;
  doctor_id: string;
  doctor_nombre: string;
  procedimiento: string;
  contenido: string;
  created_at: Date;
}

function toView(row: ConsentimientoRow): ConsentimientoView {
  return {
    id: row.id,
    patientId: row.patient_id,
    presupuestoId: row.presupuesto_id,
    doctorId: row.doctor_id,
    doctorNombre: row.doctor_nombre,
    procedimiento: row.procedimiento,
    contenido: row.contenido,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** Adaptador Drizzle/Postgres del consentimiento informado. Solo INSERT + SELECT. */
@Injectable()
export class DrizzleConsentimientoRepository implements ConsentimientoRepository {
  async crear(tx: Tx, consentimiento: Consentimiento): Promise<ConsentimientoView> {
    const p = consentimiento.toProps();
    const result = await tx.execute(sql`
      INSERT INTO consentimientos (patient_id, presupuesto_id, doctor_id, procedimiento, contenido)
      VALUES (${p.patientId}, ${p.presupuestoId}, ${p.doctorId}, ${p.procedimiento}, ${p.contenido})
      RETURNING id, patient_id, presupuesto_id, doctor_id,
                (SELECT nombre FROM users WHERE id = ${p.doctorId}) AS doctor_nombre,
                procedimiento, contenido, created_at
    `);
    return toView((result.rows as unknown as ConsentimientoRow[])[0]!);
  }

  async listarPorPaciente(tx: Tx, patientId: string): Promise<ConsentimientoView[]> {
    const result = await tx.execute(sql`
      SELECT c.id, c.patient_id, c.presupuesto_id, c.doctor_id, u.nombre AS doctor_nombre,
             c.procedimiento, c.contenido, c.created_at
        FROM consentimientos c
        JOIN users u ON u.id = c.doctor_id
       WHERE c.patient_id = ${patientId}
       ORDER BY c.created_at DESC
    `);
    return (result.rows as unknown as ConsentimientoRow[]).map(toView);
  }
}
