import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  EstatusOrdenPlantillas,
  OrdenPlantillasContent,
  OrdenPlantillasDetalle,
  OrdenPlantillasView,
  SexoPaciente,
} from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import type {
  NewOrdenPlantillasInput,
  OrdenPlantillasRepository,
} from '../domain/orden-plantillas.repository';

interface Row {
  id: string;
  patient_id: string;
  appointment_id: string | null;
  doctor_id: string;
  estatus: EstatusOrdenPlantillas;
  contenido: OrdenPlantillasContent;
  created_at: Date;
  updated_at: Date;
}

function toView(r: Row): OrdenPlantillasView {
  return {
    id: r.id,
    patientId: r.patient_id,
    appointmentId: r.appointment_id,
    doctorId: r.doctor_id,
    estatus: r.estatus,
    contenido: r.contenido,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

@Injectable()
export class DrizzleOrdenPlantillasRepository implements OrdenPlantillasRepository {
  async findByAppointment(tx: Tx, appointmentId: string): Promise<OrdenPlantillasView | null> {
    const result = await tx.execute(sql`
      SELECT id, patient_id, appointment_id, doctor_id, estatus, contenido, created_at, updated_at
        FROM ordenes_plantillas
       WHERE appointment_id = ${appointmentId}
       LIMIT 1
    `);
    const row = (result.rows as unknown as Row[])[0];
    return row ? toView(row) : null;
  }

  async findById(tx: Tx, id: string): Promise<OrdenPlantillasView | null> {
    const result = await tx.execute(sql`
      SELECT id, patient_id, appointment_id, doctor_id, estatus, contenido, created_at, updated_at
        FROM ordenes_plantillas
       WHERE id = ${id}
       LIMIT 1
    `);
    const row = (result.rows as unknown as Row[])[0];
    return row ? toView(row) : null;
  }

  async create(tx: Tx, input: NewOrdenPlantillasInput): Promise<OrdenPlantillasView> {
    const result = await tx.execute(sql`
      INSERT INTO ordenes_plantillas (patient_id, doctor_id, appointment_id)
      VALUES (${input.patientId}, ${input.doctorId}, ${input.appointmentId})
      RETURNING id, patient_id, appointment_id, doctor_id, estatus, contenido, created_at, updated_at
    `);
    return toView((result.rows as unknown as Row[])[0]!);
  }

  async saveContent(tx: Tx, id: string, contenido: OrdenPlantillasContent): Promise<void> {
    await tx.execute(sql`
      UPDATE ordenes_plantillas
         SET contenido = ${JSON.stringify(contenido)}::jsonb,
             updated_at = now()
       WHERE id = ${id}
    `);
  }

  async setEstatus(tx: Tx, id: string, estatus: EstatusOrdenPlantillas): Promise<void> {
    await tx.execute(sql`
      UPDATE ordenes_plantillas
         SET estatus = ${estatus},
             updated_at = now()
       WHERE id = ${id}
    `);
  }

  async findDetalleById(tx: Tx, id: string): Promise<OrdenPlantillasDetalle | null> {
    const result = await tx.execute(sql`
      SELECT o.id, o.patient_id, o.appointment_id, o.doctor_id, o.estatus, o.contenido,
             o.created_at, o.updated_at,
             p.nombre AS patient_nombre,
             p.telefono AS patient_telefono,
             p.sexo AS patient_sexo,
             date_part('year', age(p.fecha_nacimiento))::int AS patient_edad,
             u.nombre AS doctor_nombre,
             u.cedula_profesional AS doctor_cedula,
             u.cedula_especialidad AS doctor_cedula_especialidad,
             t.nombre_clinica AS nombre_clinica,
             t.direccion AS direccion_clinica,
             t.telefono AS telefono_clinica
        FROM ordenes_plantillas o
        JOIN patients p ON p.id = o.patient_id
        JOIN users u ON u.id = o.doctor_id
        JOIN tenants t ON t.id = o.tenant_id
       WHERE o.id = ${id}
       LIMIT 1
    `);
    const row = (result.rows as unknown as (Row & {
      patient_nombre: string;
      patient_telefono: string | null;
      patient_sexo: SexoPaciente | null;
      patient_edad: number;
      doctor_nombre: string;
      doctor_cedula: string | null;
      doctor_cedula_especialidad: string | null;
      nombre_clinica: string;
      direccion_clinica: string | null;
      telefono_clinica: string | null;
    })[])[0];
    if (!row) return null;
    return {
      ...toView(row),
      patientNombre: row.patient_nombre,
      patientTelefono: row.patient_telefono,
      patientSexo: row.patient_sexo,
      patientEdad: row.patient_edad,
      doctorNombre: row.doctor_nombre,
      doctorCedula: row.doctor_cedula,
      doctorCedulaEspecialidad: row.doctor_cedula_especialidad,
      nombreClinica: row.nombre_clinica,
      direccionClinica: row.direccion_clinica,
      telefonoClinica: row.telefono_clinica,
    };
  }

  async listarPorPaciente(tx: Tx, patientId: string): Promise<OrdenPlantillasView[]> {
    const result = await tx.execute(sql`
      SELECT id, patient_id, appointment_id, doctor_id, estatus, contenido, created_at, updated_at
        FROM ordenes_plantillas
       WHERE patient_id = ${patientId}
       ORDER BY created_at DESC
    `);
    return (result.rows as unknown as Row[]).map(toView);
  }
}
