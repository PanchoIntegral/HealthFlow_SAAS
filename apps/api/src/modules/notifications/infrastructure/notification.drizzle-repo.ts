import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NotificationType, NotificationView } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import type {
  CreateNotificationInput,
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
