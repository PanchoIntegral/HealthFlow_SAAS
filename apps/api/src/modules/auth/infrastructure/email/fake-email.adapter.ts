import { Injectable, Logger } from '@nestjs/common';
import type { EmailInput, EmailPort } from '../../domain/email.port';

/**
 * Adaptador de correo falso para desarrollo local y pruebas: no toca red ni
 * gasta cuota de Resend. Se selecciona vía useClass en auth.module.ts
 * (NODE_ENV=test o EMAIL_PROVIDER=fake), mismo patrón que FakePacAdapter en
 * billing y FakeAlmacenamientoAdapter en radiografias.
 *
 * Loguea el correo completo a consola: en dev, así es como se "recibe" el
 * enlace de restablecimiento sin tener Resend configurado.
 */
@Injectable()
export class FakeEmailAdapter implements EmailPort {
  private readonly logger = new Logger(FakeEmailAdapter.name);

  readonly enviados: EmailInput[] = [];

  async enviar(input: EmailInput): Promise<void> {
    this.enviados.push(input);
    this.logger.log(`[correo falso] Para: ${input.to} · Asunto: ${input.subject}\n${input.html}`);
  }
}
