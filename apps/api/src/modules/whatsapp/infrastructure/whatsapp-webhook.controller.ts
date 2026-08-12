import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';
import { env } from '../../../config/env';
import type { Database } from '../../../db/drizzle';
import { DB } from '../../../db/drizzle.module';
import { ProcesarWebhookUseCase } from '../application/procesar-webhook.use-case';

/** Solo lo que este handler necesita — evita depender del tipo `Request` de express. */
interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Webhook de Meta. **La única ruta pública de escritura de toda la API.**
 *
 * Aquí una ruta es pública simplemente por no llevar `@UseGuards(JwtAuthGuard)`,
 * y el SuscripcionInterceptor exenta de paso lo que no está autenticado. Eso
 * significa que la ÚNICA defensa es la firma HMAC, y por eso se verifica antes
 * de tocar la base y antes de interpretar el cuerpo: sin ella, cualquiera con
 * la URL podría cancelar citas ajenas mandando un POST.
 *
 * El handler responde 200 lo antes posible y hace el trabajo después: Meta
 * reintenta el evento si tardamos, y un reintento llegando a media faena
 * produciría acciones duplicadas.
 */
@Controller('whatsapp')
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly procesar: ProcesarWebhookUseCase,
  ) {}

  /**
   * Handshake de verificación. Meta llama una vez al configurar el webhook con
   * un token que elegimos nosotros y espera de vuelta el `challenge`.
   */
  @Get('webhook')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  verificar(
    @Query('hub.mode') modo?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    if (modo !== 'subscribe' || !token || !challenge || !igual(token, env.whatsappVerifyToken)) {
      // Sin detalle: quien esté probando tokens no debe saber si falló el modo,
      // el token o el challenge.
      throw new ForbiddenException();
    }
    return challenge;
  }

  /**
   * Eventos: acuses de entrega y respuestas del paciente.
   *
   * Límite propio y estrecho porque es el punto de entrada anónimo: sin él, un
   * flood de firmas inválidas costaría un HMAC por petición.
   */
  @Post('webhook')
  // 200 explícito: Nest respondería 201 a un POST, y Meta espera un 200 para
  // dar el evento por entregado.
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 300 }, burst: { ttl: 1_000, limit: 30 } })
  async recibir(@Req() req: RawBodyRequest<WebhookRequest>): Promise<{ received: true }> {
    const firma = req.headers['x-hub-signature-256'];
    if (!req.rawBody || typeof firma !== 'string' || !firmaValida(req.rawBody, firma)) {
      throw new ForbiddenException();
    }

    // A partir de aquí el cuerpo es de Meta. Se registra por su hash para no
    // procesar dos veces el mismo evento cuando Meta reintente; el payload NO
    // se guarda: trae teléfonos de pacientes y esta tabla no tiene RLS.
    const id = createHash('sha256').update(req.rawBody).digest('hex');
    let payload: unknown;
    try {
      payload = JSON.parse(req.rawBody.toString('utf8'));
    } catch {
      // Firma válida pero cuerpo ilegible: no hay nada que hacer, y devolver
      // un error solo provocaría reintentos inútiles de Meta.
      return { received: true };
    }

    const nuevo = await this.registrar(id, tipoDe(payload));
    if (!nuevo) return { received: true };

    // Se responde YA y se procesa después. La durabilidad no la da una cola
    // propia sino el reintento de Meta: si esto falla se borra el registro del
    // evento, de modo que cuando Meta lo reenvíe se vuelva a procesar. Por eso
    // el payload no hace falta guardarlo — y no se guarda, porque trae
    // teléfonos de pacientes y esta tabla no tiene RLS.
    void this.procesarYMarcar(id, payload);
    return { received: true };
  }

  /** `false` si el evento ya se había registrado antes. */
  private async registrar(id: string, tipo: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      INSERT INTO whatsapp_events (id, tipo) VALUES (${id}, ${tipo})
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `);
    return result.rows.length > 0;
  }

  private async procesarYMarcar(id: string, payload: unknown): Promise<void> {
    try {
      await this.procesar.execute(payload);
      await this.db.execute(
        sql`UPDATE whatsapp_events SET processed_at = now() WHERE id = ${id}`,
      );
    } catch (error) {
      // Se borra el registro para que el reintento de Meta sí surta efecto. Es
      // la misma lección que dejó el webhook de Stripe en 0020: un evento
      // marcado como visto antes de procesarse se pierde para siempre.
      this.logger.error(
        `Fallo procesando el evento ${id.slice(0, 12)}…: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.db
        .execute(sql`DELETE FROM whatsapp_events WHERE id = ${id} AND processed_at IS NULL`)
        .catch(() => undefined);
    }
  }
}

/**
 * HMAC-SHA256 del cuerpo CRUDO con el secreto de la app de Meta.
 *
 * Contra el cuerpo crudo y nunca contra el ya reserializado: el orden de las
 * claves de un JSON no se conserva al volver a serializarlo, y comparar la
 * firma de otro texto invalidaría el propósito de firmarlo. Disponible gracias
 * a `NestFactory.create(AppModule, { rawBody: true })`, que ya estaba por el
 * webhook de Stripe.
 */
export function firmaValida(cuerpo: Buffer, cabecera: string): boolean {
  const esperada =
    'sha256=' + createHmac('sha256', env.whatsappAppSecret).update(cuerpo).digest('hex');
  return igual(cabecera, esperada);
}

/**
 * Comparación en tiempo constante. `timingSafeEqual` LANZA si los buffers
 * difieren en longitud, así que hay que medir antes — y ahí no se filtra nada
 * útil, porque la longitud de una firma hexadecimal es siempre la misma.
 */
function igual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Etiqueta gruesa para poder mirar la tabla y entender qué está llegando. */
function tipoDe(payload: unknown): string {
  const entry = (payload as { entry?: unknown[] })?.entry;
  const value = (entry?.[0] as { changes?: { value?: Record<string, unknown> }[] })?.changes?.[0]
    ?.value;
  if (value?.statuses) return 'status';
  if (value?.messages) return 'message';
  return 'otro';
}
