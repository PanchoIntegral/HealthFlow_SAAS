import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../db/drizzle';
import type { MessageChannel, MessageKind, MessageScheduler, ScheduleMessagesInput } from './messaging.types';

@Injectable()
export class OutboxService implements MessageScheduler {
  async schedule(tx: Tx, input: ScheduleMessagesInput): Promise<void> {
    const channels: MessageChannel[] = [];
    if (input.preferredChannel === 'whatsapp' && input.whatsappOptIn && input.phone) channels.push('whatsapp');
    if (input.preferredChannel === 'email' && input.email) channels.push('email');
    // Confirmación inmediata y recordatorios. No se cae la transacción si el
    // paciente eligió un canal para el que no dejó destino/consentimiento.
    const jobs: { channel: MessageChannel; kind: MessageKind; at: Date; key: string }[] = [];
    for (const channel of channels) {
      const firstKind = input.kind ?? 'confirmation';
      jobs.push({ channel, kind: firstKind, at: new Date(), key: `${input.appointmentId}:${firstKind}:${channel}:${input.startsAt.toISOString()}` });
      if (!input.kind || input.kind === 'rescheduled') {
        for (const hours of [...new Set(input.reminderHours)].sort((a, b) => b - a)) {
          const at = new Date(input.startsAt.getTime() - hours * 3_600_000);
          if (at.getTime() > Date.now()) jobs.push({ channel, kind: 'reminder', at, key: `${input.appointmentId}:reminder:${hours}:${channel}:${input.startsAt.toISOString()}` });
        }
      }
    }
    for (const job of jobs) {
      await tx.execute(sql`
        WITH inserted AS (INSERT INTO outbound_messages
          (appointment_id,patient_id,channel,kind,scheduled_at,status,provider,idempotency_key,next_attempt_at)
        SELECT ${input.appointmentId},${input.patientId},${job.channel},${job.kind},
          ${job.at.toISOString()},'pending',${job.channel === 'whatsapp' ? 'twilio' : 'resend'},${job.key},${job.at.toISOString()}
        WHERE ${job.channel} <> 'email' OR NOT EXISTS
          (SELECT 1 FROM patients WHERE id=${input.patientId} AND email_suppressed_at IS NOT NULL)
        ON CONFLICT (idempotency_key) DO NOTHING RETURNING appointment_id)
        INSERT INTO messaging_events(appointment_id,event)
        SELECT appointment_id,'scheduled' FROM inserted
      `);
    }
  }

  async cancelPending(tx: Tx, appointmentId: string): Promise<void> {
    await tx.execute(sql`
      UPDATE outbound_messages SET status='cancelled', updated_at=now()
       WHERE appointment_id=${appointmentId} AND status IN ('pending','failed','processing')
    `);
  }
}
