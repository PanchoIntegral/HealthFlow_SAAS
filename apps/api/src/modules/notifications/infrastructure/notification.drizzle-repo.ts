import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NotificationType, NotificationView } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import type {
  CreateNotificationInput,
  NotificationForUser,
  NotificationRepository,
} from '../domain/notification.repository';

interface NotificationRow {
  id: string;
  tipo: NotificationType;
  titulo: string;
  mensaje: string;
  appointment_id: string | null;
  leida_at: Date | null;
  created_at: Date;
}

interface NotificationForUserRow extends NotificationRow {
  user_id: string;
}

/**
 * Adaptador concreto (Drizzle/Postgres) del puerto NotificationRepository.
 * Todas las queries corren sobre la transacción `tx` con el tenant fijado,
 * por lo que RLS garantiza el aislamiento sin filtros manuales de tenant_id.
 */
@Injectable()
export class DrizzleNotificationRepository implements NotificationRepository {
  async listForUser(tx: Tx, userId: string, limit = 30): Promise<NotificationView[]> {
    const result = await tx.execute(sql`
      SELECT id, tipo, titulo, mensaje, appointment_id, leida_at, created_at
        FROM notifications
       WHERE user_id = ${userId}
       ORDER BY created_at DESC
       LIMIT ${limit}
    `);
    return (result.rows as unknown as NotificationRow[]).map(mapRow);
  }

  async create(tx: Tx, input: CreateNotificationInput): Promise<NotificationView> {
    const result = await tx.execute(sql`
      INSERT INTO notifications (user_id, appointment_id, tipo, titulo, mensaje)
      VALUES (${input.userId}, ${input.appointmentId}, ${input.tipo}, ${input.titulo}, ${input.mensaje})
      RETURNING id, tipo, titulo, mensaje, appointment_id, leida_at, created_at
    `);
    return mapRow(result.rows[0] as unknown as NotificationRow);
  }

  async markRead(tx: Tx, id: string, userId: string): Promise<boolean> {
    const result = await tx.execute(sql`
      UPDATE notifications SET leida_at = now()
       WHERE id = ${id} AND user_id = ${userId} AND leida_at IS NULL
       RETURNING id
    `);
    return result.rows.length > 0;
  }

  async markAllRead(tx: Tx, userId: string): Promise<void> {
    await tx.execute(sql`
      UPDATE notifications SET leida_at = now()
       WHERE user_id = ${userId} AND leida_at IS NULL
    `);
  }

  async syncRemindersCitaProxima(tx: Tx, windowMinutes: number): Promise<NotificationForUser[]> {
    const result = await tx.execute(sql`
      WITH candidatas AS (
        SELECT a.id AS appointment_id, a.doctor_id, a.inicio_programado, p.nombre AS patient_nombre
          FROM appointments a
          JOIN patients p ON p.id = a.patient_id
         WHERE a.estatus IN ('agendada', 'en_espera')
           AND a.inicio_programado BETWEEN now() AND now() + (${windowMinutes} || ' minutes')::interval
      )
      INSERT INTO notifications (user_id, appointment_id, tipo, titulo, mensaje)
      SELECT doctor_id, appointment_id, 'cita_proxima',
             'Cita en ' || ${windowMinutes} || ' min',
             patient_nombre || ' · ' || to_char(inicio_programado, 'HH24:MI')
        FROM candidatas
      ON CONFLICT (appointment_id) WHERE tipo = 'cita_proxima' DO NOTHING
      RETURNING id, user_id, tipo, titulo, mensaje, appointment_id, leida_at, created_at
    `);
    return (result.rows as unknown as NotificationForUserRow[]).map((row) => ({
      userId: row.user_id,
      notification: mapRow(row),
    }));
  }
}

function mapRow(row: NotificationRow): NotificationView {
  return {
    id: row.id,
    tipo: row.tipo,
    titulo: row.titulo,
    mensaje: row.mensaje,
    appointmentId: row.appointment_id,
    leidaAt: row.leida_at ? new Date(row.leida_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
