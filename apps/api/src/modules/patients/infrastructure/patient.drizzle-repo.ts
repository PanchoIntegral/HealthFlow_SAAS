import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ANTECEDENTES_VACIOS,
  type Alergia,
  type AntecedentesPaciente,
  type HistorialPaciente,
  type PatientSummary,
  type UpdateHistorialRequest,
} from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import { Patient } from '../domain/patient.entity';
import type { PatientRepository } from '../domain/patient.repository';

interface PatientRow {
  id: string;
  nombre: string;
  edad: number;
  curp: string | null;
  telefono: string | null;
}

/**
 * Adaptador Drizzle/Postgres del puerto PatientRepository. Corre sobre la
 * transacción con tenant fijado: RLS aísla las lecturas y el DEFAULT
 * current_tenant_id() rellena tenant_id en el insert.
 */
@Injectable()
export class DrizzlePatientRepository implements PatientRepository {
  async create(tx: Tx, patient: Patient): Promise<string> {
    const p = patient.toProps();
    // tenant_id se autocompleta por DEFAULT current_tenant_id() (ver 0003).
    const result = await tx.execute(sql`
      INSERT INTO patients (nombre, fecha_nacimiento, curp, telefono)
      VALUES (${p.nombre}, ${p.fechaNacimiento}, ${p.curp}, ${p.telefono})
      RETURNING id
    `);
    return (result.rows[0] as { id: string }).id;
  }

  async existsByCurp(tx: Tx, curp: string): Promise<boolean> {
    const result = await tx.execute(
      sql`SELECT 1 FROM patients WHERE curp = ${curp} LIMIT 1`,
    );
    return result.rows.length > 0;
  }

  async contarTodos(tx: Tx): Promise<number> {
    const result = await tx.execute(sql`SELECT count(*)::int AS total FROM patients`);
    return (result.rows as unknown as { total: number }[])[0]?.total ?? 0;
  }

  async search(tx: Tx, query: string, limit: number): Promise<PatientSummary[]> {
    const like = `${query.toLowerCase()}%`;
    const result = await tx.execute(sql`
      SELECT id,
             nombre,
             date_part('year', age(fecha_nacimiento))::int AS edad,
             curp,
             telefono
        FROM patients
       WHERE lower(nombre) LIKE ${like}
          OR lower(curp) LIKE ${like}
       ORDER BY nombre ASC
       LIMIT ${limit}
    `);
    return (result.rows as unknown as PatientRow[]).map((r) => ({
      id: r.id,
      nombre: r.nombre,
      edad: Number(r.edad),
      curp: r.curp,
      telefono: r.telefono,
    }));
  }

  async list(tx: Tx, limit: number): Promise<PatientSummary[]> {
    const result = await tx.execute(sql`
      SELECT id,
             nombre,
             date_part('year', age(fecha_nacimiento))::int AS edad,
             curp,
             telefono
        FROM patients
       ORDER BY nombre ASC
       LIMIT ${limit}
    `);
    return (result.rows as unknown as PatientRow[]).map((r) => ({
      id: r.id,
      nombre: r.nombre,
      edad: Number(r.edad),
      curp: r.curp,
      telefono: r.telefono,
    }));
  }

  async updateHistorial(
    tx: Tx,
    patientId: string,
    input: UpdateHistorialRequest,
  ): Promise<HistorialPaciente | null> {
    // Reemplazo completo, no merge: la pantalla envía siempre el historial
    // entero, y un merge parcial haría imposible BORRAR una alergia que se
    // capturó por error — justo la operación que más importa que funcione.
    const result = await tx.execute(sql`
      UPDATE patients
         SET sin_alergias_conocidas = ${input.sinAlergiasConocidas},
             alergias      = ${JSON.stringify(input.alergias)}::jsonb,
             antecedentes  = ${JSON.stringify(input.antecedentes)}::jsonb
       WHERE id = ${patientId}
      RETURNING sin_alergias_conocidas, alergias, antecedentes
    `);
    const row = (
      result.rows as unknown as {
        sin_alergias_conocidas: boolean;
        alergias: Alergia[] | null;
        antecedentes: AntecedentesPaciente | null;
      }[]
    )[0];
    if (!row) return null;

    return {
      sinAlergiasConocidas: row.sin_alergias_conocidas,
      alergias: row.alergias ?? [],
      antecedentes: row.antecedentes ?? ANTECEDENTES_VACIOS,
    };
  }
}
