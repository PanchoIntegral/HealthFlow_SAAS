import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env';
import type { MessagingProvider, ProviderMessage, SendResult } from './messaging.types';

export function renderPrivacySafeBody(m: ProviderMessage): string {
  if (m.kind === 'recall') {
    return `Clínica ${m.clinicName}, mediante HealthFlow: es momento de agendar una revisión. Reserva aquí: ${m.bookingUrl}`;
  }
  const when = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: m.timezone }).format(m.startsAt);
  const action = m.kind === 'cancelled' ? 'se canceló' : m.kind === 'rescheduled' ? 'se reprogramó' : m.kind === 'reminder' ? 'te recordamos tu cita' : 'tu cita quedó reservada';
  return `Clínica ${m.clinicName}, mediante HealthFlow: ${action} para ${when}. Adminístrala aquí: ${m.manageUrl}`;
}

/** Escapa los datos variables antes de insertarlos en el HTML del correo. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function emailSubject(m: ProviderMessage): string {
  const clinic = m.clinicName;
  if (m.kind === 'recall') return `Agenda tu próxima visita · ${clinic}`;
  if (m.kind === 'reminder') return `Recordatorio: tu cita es pronto · ${clinic}`;
  if (m.kind === 'rescheduled') return `Tu cita fue reprogramada · ${clinic}`;
  if (m.kind === 'cancelled') return `Tu cita fue cancelada · ${clinic}`;
  return `Tu cita está confirmada · ${clinic}`;
}

/**
 * Correo HTML con tablas y estilos en línea para que funcione de forma
 * consistente en Gmail, Outlook y clientes móviles. Conserva el mismo nivel
 * de privacidad que la versión de texto: no incluye paciente ni datos clínicos.
 */
export function renderPrivacySafeEmail(m: ProviderMessage): string {
  const clinic = escapeHtml(m.clinicName);
  const isRecall = m.kind === 'recall';
  const url = isRecall ? m.bookingUrl : m.manageUrl;
  const safeUrl = escapeHtml(url);
  const when = !isRecall
    ? escapeHtml(new Intl.DateTimeFormat('es-MX', { dateStyle: 'full', timeStyle: 'short', timeZone: m.timezone }).format(m.startsAt))
    : null;
  const copy = isRecall
    ? { title: 'Es momento de agendar tu próxima visita', intro: `Mantén el cuidado de tu salud al día con ${clinic}.`, cta: 'Agendar una cita' }
    : m.kind === 'reminder'
      ? { title: 'Te recordamos tu cita', intro: `Tienes una cita próxima en ${clinic}.`, cta: 'Ver mi cita' }
      : m.kind === 'rescheduled'
        ? { title: 'Tu cita fue reprogramada', intro: `Consulta los nuevos detalles de tu cita en ${clinic}.`, cta: 'Ver mi cita' }
        : m.kind === 'cancelled'
          ? { title: 'Tu cita fue cancelada', intro: `Puedes consultar los detalles de tu cita en ${clinic}.`, cta: 'Ver detalles' }
          : { title: 'Tu cita está confirmada', intro: `Tu cita en ${clinic} quedó reservada.`, cta: 'Ver mi cita' };

  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background:#f4f7fb;color:#172033;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f7fb;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;">
          <tr><td style="height:6px;background:linear-gradient(90deg,#2563eb,#14b8a6);"></td></tr>
          <tr><td style="padding:30px 32px 20px;">
            <p style="margin:0;color:#2563eb;font-size:19px;font-weight:700;letter-spacing:-0.3px;">Health<span style="color:#14b8a6;">Flow</span></p>
            <p style="margin:22px 0 8px;font-size:25px;line-height:32px;font-weight:700;color:#172033;">${copy.title}</p>
            <p style="margin:0;color:#526075;font-size:16px;line-height:24px;">${copy.intro}</p>
          </td></tr>
          ${when ? `<tr><td style="padding:4px 32px 24px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#eff6ff;border:1px solid #dbeafe;border-radius:12px;"><tr><td style="padding:18px 20px;"><p style="margin:0 0 5px;color:#2563eb;font-size:12px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">Fecha y hora</p><p style="margin:0;color:#172033;font-size:16px;line-height:24px;font-weight:700;">${when}</p><p style="margin:6px 0 0;color:#64748b;font-size:13px;line-height:18px;">Hora local de la clínica</p></td></tr></table></td></tr>` : ''}
          <tr><td style="padding:0 32px 32px;">
            <a href="${safeUrl}" style="display:inline-block;background:#2563eb;border-radius:9px;color:#ffffff;font-size:16px;font-weight:700;line-height:20px;padding:14px 22px;text-decoration:none;">${copy.cta}</a>
          </td></tr>
          <tr><td style="border-top:1px solid #e7edf5;padding:20px 32px 28px;">
            <p style="margin:0;color:#7b8798;font-size:12px;line-height:18px;">Este es un mensaje automático de ${clinic} mediante HealthFlow.</p>
            <p style="margin:8px 0 0;color:#7b8798;font-size:12px;line-height:18px;">Si el botón no funciona, copia este enlace en tu navegador:<br><a href="${safeUrl}" style="color:#2563eb;word-break:break-all;">${safeUrl}</a></p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
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
    const variables = message.kind === 'recall'
      ? { 1: message.clinicName, 2: message.bookingUrl }
      : {
          1: message.clinicName,
          2: new Intl.DateTimeFormat('es-MX',{dateStyle:'medium',timeStyle:'short',timeZone:message.timezone}).format(message.startsAt),
          3: message.manageUrl,
        };
    const form = new URLSearchParams({
      From: `whatsapp:${env.twilioWhatsappFrom}`,
      To: `whatsapp:${message.destination}`,
      ContentSid: env.twilioContentSid(message.kind),
      ContentVariables: JSON.stringify(variables),
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
      body: JSON.stringify({
        from: env.emailFrom,
        to: [message.destination],
        subject: emailSubject(message),
        html: renderPrivacySafeEmail(message),
        text: renderPrivacySafeBody(message),
      }),
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
