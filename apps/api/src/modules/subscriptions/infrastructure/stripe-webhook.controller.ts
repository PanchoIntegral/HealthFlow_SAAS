import { BadRequestException, Controller, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { env } from '../../../config/env';
import { HandleStripeWebhookUseCase } from '../application/handle-stripe-webhook.use-case';
import { StripeService } from './stripe.service';

/** Solo lo que este handler necesita — evita depender del tipo `Request` de express. */
interface StripeWebhookRequest {
  headers: Record<string, string | string[] | undefined>;
}

@Controller('subscriptions')
export class StripeWebhookController {
  constructor(
    private readonly stripe: StripeService,
    private readonly handleWebhook: HandleStripeWebhookUseCase,
  ) {}

  /**
   * La firma se verifica contra el body CRUDO (Buffer), nunca contra el body
   * ya parseado por Nest — la forma del payload varía por tipo de evento, así
   * que confiar en un body reserializado invalidaría el propósito de verificar
   * la firma. Requiere `NestFactory.create(AppModule, { rawBody: true })`.
   */
  @Post('webhook')
  async webhook(
    @Req() req: RawBodyRequest<StripeWebhookRequest>,
  ): Promise<{ received: true }> {
    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string' || !req.rawBody) {
      throw new BadRequestException('Falta la firma de Stripe');
    }

    let event;
    try {
      event = this.stripe.client.webhooks.constructEvent(
        req.rawBody,
        signature,
        env.stripeWebhookSecret,
      );
    } catch {
      throw new BadRequestException('Firma de Stripe inválida');
    }

    await this.handleWebhook.execute(event);
    return { received: true };
  }
}
