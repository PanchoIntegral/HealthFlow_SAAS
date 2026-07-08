import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { WaitingRoomEntry, AppointmentStatus } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import { appointments } from '../../../db/schema';
import { Appointment } from '../domain/appointment.entity';
import type { AppointmentRepository } from '../domain/appointment.repository';

interface WaitingRoomRow {
  appointment_id: string;
  patient_id: string;
  patient_nombre: string;
  patient_edad: number;
  estatus: AppointmentStatus;
  motivo: string | null;
  inicio_programado: Date;
  checkin_at: Date | null;
}

/**
 * Adaptador concreto (Drizzle/Postgres) del puerto AppointmentRepository.
 * Todas las queries corren sobre la transacción `tx` con el tenant fijado,
 * por lo que RLS garantiza el aislamiento sin filtros manuales de tenant_id.
 */
@Injectable()
export class DrizzleAppointmentRepository implements AppointmentRepository {
  async findById(tx: Tx, id: string): Promise<Appointment | null> {
    const rows = await tx.select().from(appointments).where(eq(appointments.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return Appointment.fromState({
      id: row.id,
      tenantId: row.tenantId,
      patientId: row.patientId,
      doctorId: row.doctorId,
      estatus: row.estatus as AppointmentStatus,
      checkinAt: row.checkinAt,
      inicioReal: row.inicioReal,
      finReal: row.finReal,
    });
  }

  async save(tx: Tx, appointment: Appointment): Promise<void> {
    const s = appointment.toState();
    await tx
      .update(appointments)
      .set({
        estatus: s.estatus,
        checkinAt: s.checkinAt,
        inicioReal: s.inicioReal,
        finReal: s.finReal,
      })
      .where(eq(appointments.id, s.id));
  }

  async listWaitingRoom(tx: Tx): Promise<WaitingRoomEntry[]> {
    const result = await tx.execute(sql`
      SELECT a.id            AS appointment_id,
             p.id            AS patient_id,
             p.nombre        AS patient_nombre,
             date_part('year', age(p.fecha_nacimiento))::int AS patient_edad,
             a.estatus       AS estatus,
             a.motivo        AS motivo,
             a.inicio_programado AS inicio_programado,
             a.checkin_at    AS checkin_at
        FROM appointments a
        JOIN patients p ON p.id = a.patient_id
       WHERE a.inicio_programado::date = current_date
       ORDER BY a.inicio_programado ASC
    `);
    return (result.rows as unknown as WaitingRoomRow[]).map(mapRow);
  }

  async findWaitingRoomEntry(tx: Tx, appointmentId: string): Promise<WaitingRoomEntry | null> {
    const result = await tx.execute(sql`
      SELECT a.id            AS appointment_id,
             p.id            AS patient_id,
             p.nombre        AS patient_nombre,
             date_part('year', age(p.fecha_nacimiento))::int AS patient_edad,
             a.estatus       AS estatus,
             a.motivo        AS motivo,
             a.inicio_programado AS inicio_programado,
             a.checkin_at    AS checkin_at
        FROM appointments a
        JOIN patients p ON p.id = a.patient_id
       WHERE a.id = ${appointmentId}
       LIMIT 1
    `);
    const row = (result.rows as unknown as WaitingRoomRow[])[0];
    return row ? mapRow(row) : null;
  }
}

function mapRow(row: WaitingRoomRow): WaitingRoomEntry {
  return {
    appointmentId: row.appointment_id,
    patientId: row.patient_id,
    patientNombre: row.patient_nombre,
    patientEdad: Number(row.patient_edad),
    estatus: row.estatus,
    motivo: row.motivo,
    inicioProgramado: new Date(row.inicio_programado).toISOString(),
    checkinAt: row.checkin_at ? new Date(row.checkin_at).toISOString() : null,
  };
}
