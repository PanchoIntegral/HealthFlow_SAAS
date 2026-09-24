import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type {
  AppointmentStatus,
  AppointmentView,
  DoctorSummary,
  WaitingRoomEntry,
} from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import { appointments } from '../../../db/schema';
import { Appointment } from '../domain/appointment.entity';
import type { AppointmentRepository, NewAppointmentInput } from '../domain/appointment.repository';

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

interface AppointmentViewRow {
  id: string;
  patient_id: string;
  patient_nombre: string;
  doctor_id: string;
  doctor_nombre: string;
  motivo: string | null;
  inicio_programado: Date;
  fin_programado: Date;
  estatus: AppointmentStatus;
  origen: 'interno' | 'publico';
  estado_confirmacion: 'pendiente' | 'confirmada' | 'cancelada';
  posible_duplicado: boolean;
}

/** Estados que NO bloquean el horario del médico al validar traslape. */
const ESTADOS_NO_BLOQUEANTES = ['cancelada', 'no_asistio'] as const;

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
      finProgramado: row.finProgramado,
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
    if (s.estatus === 'cancelada') {
      await tx.execute(sql`UPDATE appointments SET estado_confirmacion='cancelada' WHERE id=${s.id}`);
    }
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
       -- Rango en vez de un cast a ::date comparado con current_date: el cast
       -- se evalúa por fila y deja inservible el índice por fecha. El rango
       -- delimita el MISMO día (current_date se resuelve en la zona horaria de
       -- la sesión, igual que hacía el cast), pero sí usa el índice.
       WHERE a.inicio_programado >= current_date::timestamptz
         AND a.inicio_programado <  (current_date + 1)::timestamptz
       ORDER BY a.inicio_programado ASC
    `);
    return (result.rows as unknown as WaitingRoomRow[]).map(mapRow);
  }

  async findWaitingRoomEntry(
    tx: Tx,
    appointmentId: string,
    opts?: { soloHoy?: boolean },
  ): Promise<WaitingRoomEntry | null> {
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
         -- mismo criterio de "hoy" que listWaitingRoom, para que un evento
         -- realtime nunca meta en la lista una cita de otro día.
         ${opts?.soloHoy ? sql`AND a.inicio_programado::date = current_date` : sql``}
       LIMIT 1
    `);
    const row = (result.rows as unknown as WaitingRoomRow[])[0];
    return row ? mapRow(row) : null;
  }

  async create(tx: Tx, input: NewAppointmentInput): Promise<string> {
    // tenant_id se autocompleta por DEFAULT current_tenant_id() (ver 0005).
    const result = await tx.execute(sql`
      INSERT INTO appointments (id, patient_id, doctor_id, motivo, inicio_programado, fin_programado, estatus, public_manage_token_hash, manage_token_expires_at)
      VALUES (${input.id}, ${input.patientId}, ${input.doctorId}, ${input.motivo},
              ${input.inicioProgramado.toISOString()}, ${input.finProgramado.toISOString()}, 'agendada',
              ${input.publicManageTokenHash}, ${input.manageTokenExpiresAt.toISOString()})
      RETURNING id
    `);
    return (result.rows[0] as { id: string }).id;
  }

  async reschedule(tx: Tx, appointmentId: string, input: Pick<NewAppointmentInput, 'doctorId' | 'inicioProgramado' | 'finProgramado'>): Promise<void> {
    await tx.execute(sql`
      UPDATE appointments
         SET doctor_id=${input.doctorId},
             inicio_programado=${input.inicioProgramado.toISOString()},
             fin_programado=${input.finProgramado.toISOString()},
             estado_confirmacion='pendiente',
             confirmada_at=NULL,
             messaging_version=messaging_version+1,
             manage_token_expires_at=${new Date(input.finProgramado.getTime() + 24 * 60 * 60 * 1000).toISOString()}
       WHERE id=${appointmentId}
    `);
  }

  async listByRange(tx: Tx, from: Date, to: Date): Promise<AppointmentView[]> {
    const result = await tx.execute(sql`
      SELECT a.id, a.patient_id, p.nombre AS patient_nombre,
             a.doctor_id, u.nombre AS doctor_nombre,
             a.motivo, a.inicio_programado, a.fin_programado, a.estatus,
             a.origen,a.estado_confirmacion,p.posible_duplicado
        FROM appointments a
        JOIN patients p ON p.id = a.patient_id
        JOIN users u ON u.id = a.doctor_id
       WHERE a.inicio_programado < ${to.toISOString()}
         AND a.fin_programado > ${from.toISOString()}
       ORDER BY a.inicio_programado ASC
    `);
    return (result.rows as unknown as AppointmentViewRow[]).map(mapViewRow);
  }

  async findView(tx: Tx, appointmentId: string): Promise<AppointmentView | null> {
    const result = await tx.execute(sql`
      SELECT a.id, a.patient_id, p.nombre AS patient_nombre,
             a.doctor_id, u.nombre AS doctor_nombre,
             a.motivo, a.inicio_programado, a.fin_programado, a.estatus,
             a.origen,a.estado_confirmacion,p.posible_duplicado
        FROM appointments a
        JOIN patients p ON p.id = a.patient_id
        JOIN users u ON u.id = a.doctor_id
       WHERE a.id = ${appointmentId}
       LIMIT 1
    `);
    const row = (result.rows as unknown as AppointmentViewRow[])[0];
    return row ? mapViewRow(row) : null;
  }

  async hasOverlap(
    tx: Tx,
    doctorId: string,
    inicioProgramado: Date,
    finProgramado: Date,
    excludeAppointmentId?: string,
  ): Promise<boolean> {
    const result = await tx.execute(sql`
      SELECT 1
        FROM appointments
       WHERE doctor_id = ${doctorId}
         AND estatus NOT IN (${sql.join(ESTADOS_NO_BLOQUEANTES.map((e) => sql`${e}`), sql`, `)})
         AND inicio_programado < ${finProgramado.toISOString()}
         AND fin_programado > ${inicioProgramado.toISOString()}
         ${excludeAppointmentId ? sql`AND id <> ${excludeAppointmentId}` : sql``}
       LIMIT 1
    `);
    return result.rows.length > 0;
  }

  async listDoctors(tx: Tx): Promise<DoctorSummary[]> {
    const result = await tx.execute(sql`
      -- es_medico cubre al dueño de la cuenta, que es 'admin' por permisos
      -- pero atiende consultas; rol = 'medico' se mantiene para que dar de
      -- alta un médico baste con asignarle el rol.
      -- Solo cuentas activas: un médico dado de baja conserva sus citas y sus
      -- notas firmadas, pero no debe poder recibir citas nuevas.
      SELECT id, nombre, especialidad
        FROM users
       WHERE activo AND (rol = 'medico' OR es_medico)
       ORDER BY nombre ASC
    `);
    return result.rows as unknown as DoctorSummary[];
  }
}

function mapViewRow(row: AppointmentViewRow): AppointmentView {
  return {
    id: row.id,
    patientId: row.patient_id,
    patientNombre: row.patient_nombre,
    doctorId: row.doctor_id,
    doctorNombre: row.doctor_nombre,
    motivo: row.motivo,
    inicioProgramado: new Date(row.inicio_programado).toISOString(),
    finProgramado: new Date(row.fin_programado).toISOString(),
    estatus: row.estatus,
    origen: row.origen,
    estadoConfirmacion: row.estado_confirmacion,
    posibleDuplicado: row.posible_duplicado,
  };
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
