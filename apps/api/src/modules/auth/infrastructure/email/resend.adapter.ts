import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../../../config/env';
import type { EmailInput, EmailPort } from '../../domain/email.port';

const TIMEOUT_MS = 10_000;

/**
 * Adaptador real de Resend. API REST de un solo POST — fetch crudo, sin SDK,
 * mismo criterio que facturapi.adapter.ts.
 *
 * A diferencia del timbrado fiscal, un correo que falla no es una operación
 * que deba reintentarse a toda costa ni que deba tumbar la petición HTTP del
 * usuario: se loguea el error y ya (ver AuthService.forgotPassword, que
 * siempre responde éxito genérico sin importar si el correo salió).
 */
@Injectable()
export class ResendAdapter implements EmailPort {
  private readonly logger = new Logger(ResendAdapter.name);

  async enviar(input: EmailInput): Promise<void> {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.emailFrom,
          to: input.to,
          subject: input.subject,
          html: input.html,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.error(`Resend respondió ${res.status} al enviar a ${input.to}`);
      }
    } catch (err) {
      // Nunca propaga: el flujo de "olvidé mi contraseña" no debe fallar
      // visiblemente por un correo que no salió (y tampoco debe revelar,
      // por la forma del error, si el destinatario existe).
      this.logger.error(`Error de red enviando correo a ${input.to}: ${String(err)}`);
    }
  }
}
