import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type {
  CredencialesWhatsapp,
  MensajePlantilla,
  ResultadoEnvio,
  WhatsappSender,
} from '../../application/whatsapp-sender.port';

/**
 * Adaptador de mentira: escribe el mensaje al log y devuelve un id sintético.
 *
 * Es lo que permite validar toda la lógica de tiempos, idempotencia y ruteo del
 * inbound sin esperar a que Meta apruebe la plantilla (el trámite tarda de tres
 * días a dos semanas) y sin pagar los ~$0.0085 USD de cada mensaje.
 *
 * El id lleva prefijo `fake_` a propósito: si uno aparece en producción, se ve
 * a simple vista en la base que esa clínica está mandando al vacío.
 */
@Injectable()
export class FakeWhatsappAdapter implements WhatsappSender {
  private readonly logger = new Logger('WhatsApp(fake)');

  async enviarPlantilla(
    credenciales: CredencialesWhatsapp,
    mensaje: MensajePlantilla,
  ): Promise<ResultadoEnvio> {
    const metaMessageId = `fake_${randomUUID()}`;
    this.logger.log(
      `→ ${mensaje.aE164} [${mensaje.plantilla}] ` +
        `desde ${credenciales.phoneNumberId} · ${JSON.stringify(mensaje.variables)} · ${metaMessageId}`,
    );
    return { ok: true, metaMessageId };
  }
}
