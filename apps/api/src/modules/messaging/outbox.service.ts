import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../db/drizzle';
import type { AppointmentMessageKind, MessageChannel, MessageScheduler, ScheduleMessagesInput } from './messaging.types';

export interface OutboxJob { channel: MessageChannel; kind: AppointmentMessageKind; at: Date; key: string }

/**
 * Clave de idempotencia de un trabajo de outbox. Es única por cita, generación
 * de mensajes (`messaging_version`, que sube al reprogramar), tipo, canal y,
 * en recordatorios, horas de anticipación. No depende de la fecha de la cita:
 * así reprogramar A -> B -> A no choca con las filas canceladas de la primera
 * A, y 48 h y 24 h son siempre envíos distintos.
 */
export function outboxKey(appointmentId: string, version: number, kind: AppointmentMessageKind, channel: MessageChannel, hours?: number): string {
  return hours === undefined
    ? `${appointmentId}:v${version}:${kind}:${channel}`
    : `${appointmentId}:v${version}:${kind}:${hours}h:${channel}`;
}

/** Decide qué trabajos programar. Puro: sin base de datos ni reloj implícito. */
export function buildOutboxJobs(input: ScheduleMessagesInput, messagingVersion: number, now: Date): OutboxJob[] {
  const channels: MessageChannel[] = [];
  if (input.preferredChannel === 'whatsapp' && input.whatsappOptIn && input.phone) channels.push('whatsapp');
  if (input.preferredChannel === 'email' && input.email) channels.push('email');
  const jobs: OutboxJob[] = [];
  for (const channel of channels) {
    const firstKind = input.kind ?? 'confirmation';
    jobs.push({ channel, kind: firstKind, at: now, key: outboxKey(input.appointmentId, messagingVersion, firstKind, channel) });
    if (!input.kind || input.kind === 'rescheduled') {
      for (const hours of [...new Set(input.reminderHours)].sort((a, b) => b - a)) {
        const at = new Date(input.startsAt.getTime() - hours * 3_600_000);
        if (at.getTime() > now.getTime()) jobs.push({ channel, kind: 'reminder', at, key: outboxKey(input.appointmentId, messagingVersion, 'reminder', channel, hours) });
      }
    }
  }
  return jobs;
}

@Injectable()
export class OutboxService implements MessageScheduler {
  async schedule(tx: Tx, input: ScheduleMessagesInput): Promise<void> {
    // La generación vigente vive en la cita; quien reprograma la incrementa en
    // la misma transacción antes de llamar aquí.
    const version = Number((await tx.execute(sql`SELECT messaging_version FROM appointments WHERE id=${input.appointmentId}`)).rows[0]?.['messaging_version'] ?? 1);
    // Confirmación inmediata y recordatorios. No se cae la transacción si el
    // paciente eligió un canal para el que no dejó destino/consentimiento.
    for (const job of buildOutboxJobs(input, version, new Date())) {
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
