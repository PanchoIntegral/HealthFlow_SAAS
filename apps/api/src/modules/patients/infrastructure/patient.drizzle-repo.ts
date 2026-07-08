import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PatientSummary } from '@healthflow/shared-types';
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
}
