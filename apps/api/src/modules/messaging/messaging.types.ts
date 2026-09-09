import type { Tx } from '../../db/drizzle';

export type MessageChannel = 'whatsapp' | 'email';
export type MessageKind = 'confirmation' | 'reminder' | 'rescheduled' | 'cancelled';

export interface ProviderMessage {
  channel: MessageChannel;
  destination: string;
  clinicName: string;
  timezone: string;
  kind: MessageKind;
  startsAt: Date;
  manageUrl: string;
  statusCallbackUrl?: string;
}

export interface MessagingProvider {
  send(message: ProviderMessage): Promise<{ providerMessageId: string }>;
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
  kind?: MessageKind;
}

export interface MessageScheduler {
  schedule(tx: Tx, input: ScheduleMessagesInput): Promise<void>;
  cancelPending(tx: Tx, appointmentId: string): Promise<void>;
}

export const MESSAGE_SCHEDULER = Symbol('MESSAGE_SCHEDULER');
