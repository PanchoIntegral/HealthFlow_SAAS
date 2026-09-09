import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env';
import type { MessagingProvider, ProviderMessage } from './messaging.types';

export function renderPrivacySafeBody(m: ProviderMessage): string {
  const when = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: m.timezone }).format(m.startsAt);
  const action = m.kind === 'cancelled' ? 'se canceló' : m.kind === 'rescheduled' ? 'se reprogramó' : m.kind === 'reminder' ? 'te recordamos tu cita' : 'tu cita quedó reservada';
  return `Clínica ${m.clinicName}, mediante HealthFlow: ${action} para ${when}. Adminístrala aquí: ${m.manageUrl}`;
}

@Injectable()
export class FakeMessagingProvider implements MessagingProvider {
  private readonly logger = new Logger(FakeMessagingProvider.name);
  async send(message: ProviderMessage): Promise<{ providerMessageId: string }> {
    // No registra destino ni cuerpo: ambos son datos personales.
    const id = `fake_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.logger.log(`Mensaje ${message.channel}/${message.kind} aceptado (${id})`);
    return { providerMessageId: id };
  }
}

@Injectable()
export class LiveMessagingProvider implements MessagingProvider {
  async send(message: ProviderMessage): Promise<{ providerMessageId: string }> {
    return message.channel === 'whatsapp' ? this.twilio(message) : this.resend(message);
  }

  private async twilio(message: ProviderMessage): Promise<{ providerMessageId: string }> {
    const when = new Intl.DateTimeFormat('es-MX',{dateStyle:'medium',timeStyle:'short',timeZone:message.timezone}).format(message.startsAt);
    const form = new URLSearchParams({
      From: `whatsapp:${env.twilioWhatsappFrom}`,
      To: `whatsapp:${message.destination}`,
      ContentSid: env.twilioContentSid(message.kind),
      ContentVariables: JSON.stringify({1:message.clinicName,2:when,3:message.manageUrl}),
      ...(message.statusCallbackUrl ? { StatusCallback: message.statusCallbackUrl } : {}),
    });
    const auth = Buffer.from(`${env.twilioAccountSid}:${env.twilioAuthToken}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.twilioAccountSid}/Messages.json`, {
      method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form,
    });
    const body = await res.json() as { sid?: string; code?: number };
    if (!res.ok || !body.sid) throw new Error(`twilio_${body.code ?? res.status}`);
    return { providerMessageId: body.sid };
  }

  private async resend(message: ProviderMessage): Promise<{ providerMessageId: string }> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.resendApiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `${message.kind}:${message.manageUrl}` },
      body: JSON.stringify({ from: env.emailFrom, to: [message.destination], subject: `Cita en ${message.clinicName}`, text: renderPrivacySafeBody(message) }),
    });
    const body = await res.json() as { id?: string; message?: string };
    if (!res.ok || !body.id) throw new Error(`resend_${res.status}`);
    return { providerMessageId: body.id };
  }
}
