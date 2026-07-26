import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { CreateCheckoutSessionResponse } from '@healthflow/shared-types';
import { CreateCheckoutSessionUseCase } from '../application/create-checkout-session.use-case';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';

/**
 * Endpoint público (sin JWT: todavía no existe cuenta). Rate-limited porque
 * cada llamada crea una Checkout Session real en Stripe.
 */
@Controller('subscriptions')
export class CheckoutController {
  constructor(private readonly createCheckoutSession: CreateCheckoutSessionUseCase) {}

  @Post('checkout-session')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  checkoutSession(@Body() dto: CreateCheckoutSessionDto): Promise<CreateCheckoutSessionResponse> {
    return this.createCheckoutSession.execute(dto);
  }
}
