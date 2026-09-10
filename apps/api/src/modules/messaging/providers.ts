import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env';
import type { MessagingProvider, ProviderMessage, SendResult } from './messaging.types';

export function renderPrivacySafeBody(m: ProviderMessage): string {
  const when = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: m.timezone }).format(m.startsAt);
  const action = m.kind === 'cancelled' ? 'se canceló' : m.kind === 'rescheduled' ? 'se reprogramó' : m.kind === 'reminder' ? 'te recordamos tu cita' : 'tu cita quedó reservada';
  return `Clínica ${m.clinicName}, mediante HealthFlow: ${action} para ${when}. Adminístrala aquí: ${m.manageUrl}`;
}

/** Tiempo máximo de espera al proveedor. Pasado, el resultado es `uncertain`. */
export const PROVIDER_TIMEOUT_MS = 10_000;

/**
 * Códigos de Twilio que significan "este destino/plantilla nunca va a
 * funcionar": reintentar sólo repetiría el rechazo. Referencia:
 * 21211/21614 número inválido o no móvil, 21610/21408 destino bloqueado o
 * región no permitida, 63003/63024 destino no alcanzable por WhatsApp,
 * 63013/63016/63032 política o ventana de sesión, 63005 plantilla inválida.
 */
const TWILIO_PERMANENT = new Set(['21211', '21614', '21610', '21408', '21606', '63003', '63005', '63013', '63016', '63024', '63032']);

/**
 * Clasifica una respuesta HTTP del proveedor. Regla general: 429 y 5xx son
 * transitorios; el resto de 4xx no cambiará al reintentar. Twilio además
 * identifica el motivo con un código propio.
 */
export function classifyHttpFailure(provider: 'twilio' | 'resend', httpStatus: number, providerCode?: string | number | null): SendResult {
  const code = providerCode == null ? `${provider}_${httpStatus}` : `${provider}_${providerCode}`;
  if (httpStatus === 429 || httpStatus >= 500) return { outcome: 'retryable', code };
  if (provider === 'twilio') {
    const c = String(providerCode ?? '');
    if (c === '20429' || c === '30001') return { outcome: 'retryable', code };
    if (TWILIO_PERMANENT.has(c)) return { outcome: 'permanent', code };
  }
  return { outcome: 'permanent', code };
}

/**
 * Clasifica un error de red. Un timeout o una conexión cortada después de
 * enviar la petición no dicen si el proveedor la aceptó: `uncertain`. Un
 * rechazo de conexión o DNS ocurre antes de enviar nada: `retryable`.
 */
export function classifyNetworkError(error: unknown): SendResult {
  const err = error as { name?: string; code?: string; cause?: { code?: string } };
  const code = err?.cause?.code ?? err?.code ?? err?.name ?? 'network';
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { outcome: 'retryable', code: `net_${code}` };
  return { outcome: 'uncertain', code: `net_${code}`.slice(0, 80) };
}

/** Metadatos que el fake conserva por envío. Sin destino ni cuerpo: son datos personales. */
export interface FakeSentMessage { channel: ProviderMessage['channel']; kind: ProviderMessage['kind']; idempotencyKey: string; providerMessageId: string }

@Injectable()
export class FakeMessagingProvider implements MessagingProvider {
  private readonly logger = new Logger(FakeMessagingProvider.name);
  /** Historial inspeccionable en pruebas (acotado para no crecer sin límite en dev). */
  readonly sent: FakeSentMessage[] = [];
  /** Resultados programados para simular fallos; se consumen en orden. */
  readonly scriptedResults: SendResult[] = [];
  async send(message: ProviderMessage): Promise<SendResult> {
    const scripted = this.scriptedResults.shift();
    if (scripted) return scripted;
    // No registra destino ni cuerpo: ambos son datos personales.
    const id = `fake_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.sent.push({ channel: message.channel, kind: message.kind, idempotencyKey: message.idempotencyKey, providerMessageId: id });
    if (this.sent.length > 500) this.sent.shift();
    this.logger.log(`Mensaje ${message.channel}/${message.kind} aceptado (${id})`);
    return { outcome: 'accepted', providerMessageId: id };
  }
  reset(): void { this.sent.length = 0; this.scriptedResults.length = 0; }
}

@Injectable()
export class LiveMessagingProvider implements MessagingProvider {
  async send(message: ProviderMessage): Promise<SendResult> {
    try {
      return message.channel === 'whatsapp' ? await this.twilio(message) : await this.resend(message);
    } catch (error) {
      return classifyNetworkError(error);
    }
  }

  private async twilio(message: ProviderMessage): Promise<SendResult> {
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
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    const body = await readJson<{ sid?: string; code?: number }>(res);
    if (res.ok && body?.sid) return { outcome: 'accepted', providerMessageId: body.sid };
    // 2xx sin sid: respuesta ilegible; no sabemos si aceptó.
    if (res.ok) return { outcome: 'uncertain', code: 'twilio_no_sid' };
    return classifyHttpFailure('twilio', res.status, body?.code);
  }

  private async resend(message: ProviderMessage): Promise<SendResult> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.resendApiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': message.idempotencyKey },
      body: JSON.stringify({ from: env.emailFrom, to: [message.destination], subject: `Cita en ${message.clinicName}`, text: renderPrivacySafeBody(message) }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    const body = await readJson<{ id?: string; name?: string }>(res);
    if (res.ok && body?.id) return { outcome: 'accepted', providerMessageId: body.id };
    if (res.ok) return { outcome: 'uncertain', code: 'resend_no_id' };
    return classifyHttpFailure('resend', res.status, body?.name);
  }
}

async function readJson<T>(res: Response): Promise<T | null> {
  try { return await res.json() as T; } catch { return null; }
}
