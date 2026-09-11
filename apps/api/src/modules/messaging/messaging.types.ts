import type { Tx } from '../../db/drizzle';

export type MessageChannel = 'whatsapp' | 'email';
export type AppointmentMessageKind = 'confirmation' | 'reminder' | 'rescheduled' | 'cancelled';
export type MessageKind = AppointmentMessageKind | 'recall';

interface ProviderMessageBase {
  channel: MessageChannel;
  destination: string;
  clinicName: string;
  timezone: string;
  /**
   * Clave única del trabajo de outbox (`outbound_messages.idempotency_key`).
   * El worker la entrega tal cual; el adaptador la usa como clave de
   * idempotencia del proveedor cuando éste la soporta. Nunca se deriva aquí.
   */
  idempotencyKey: string;
  statusCallbackUrl?: string;
}

/** El compilador impide renderizar un recall como si ya existiera una cita. */
export type ProviderMessage =
  | (ProviderMessageBase & {
      kind: AppointmentMessageKind;
      startsAt: Date;
      manageUrl: string;
    })
  | (ProviderMessageBase & {
      kind: 'recall';
      bookingUrl: string;
    });

/**
 * Resultado clasificado de un intento de envío.
 *  - accepted:  el proveedor devolvió un identificador.
 *  - retryable: rechazo seguro antes de aceptar (429, 5xx, conexión rechazada).
 *  - permanent: destino o plantilla inválidos; reintentar repetiría el rechazo.
 *  - uncertain: timeout o conexión cortada; no se sabe si aceptó. Nunca se
 *               reintenta automáticamente: lo decide un administrador.
 */
export type SendResult =
  | { outcome: 'accepted'; providerMessageId: string }
  | { outcome: 'retryable'; code: string }
  | { outcome: 'permanent'; code: string }
  | { outcome: 'uncertain'; code: string };

export interface MessagingProvider {
  send(message: ProviderMessage): Promise<SendResult>;
}

export const MESSAGING_PROVIDER = Symbol('MESSAGING_PROVIDER');

export interface ScheduleMessagesInput {
  appointmentId: string;
  patientId: string;
  startsAt: Date;
  email: string | null;
  phone: string | null;
  whatsappOptIn: boolean;
  preferredChannel: 'whatsapp' | 'email' | 'ninguno';
  reminderHours: number[];
  kind?: AppointmentMessageKind;
}

export interface MessageScheduler {
  schedule(tx: Tx, input: ScheduleMessagesInput): Promise<void>;
  cancelPending(tx: Tx, appointmentId: string): Promise<void>;
}

export const MESSAGE_SCHEDULER = Symbol('MESSAGE_SCHEDULER');
