import { Module } from '@nestjs/common';
import { CheckoutController } from './infrastructure/checkout.controller';
import { StripeWebhookController } from './infrastructure/stripe-webhook.controller';
import { StripeService } from './infrastructure/stripe.service';
import { CreateCheckoutSessionUseCase } from './application/create-checkout-session.use-case';
import { HandleStripeWebhookUseCase } from './application/handle-stripe-webhook.use-case';
import { OnboardingTicketsService } from './application/onboarding-tickets.service';

/**
 * Cobra el acceso a HealthFlow (Stripe). Deliberadamente separado de
 * `modules/billing` (facturación CFDI/SAT de las clínicas a sus pacientes) —
 * son dominios distintos que comparten nombre en español por coincidencia.
 *
 * Exporta OnboardingTicketsService para que AuthModule pueda canjear el
 * ticket de un solo uso en /auth/exchange-ticket, sin acoplarse al resto
 * (Stripe, checkout, etc).
 */
@Module({
  controllers: [CheckoutController, StripeWebhookController],
  providers: [
    StripeService,
    CreateCheckoutSessionUseCase,
    HandleStripeWebhookUseCase,
    OnboardingTicketsService,
  ],
  exports: [OnboardingTicketsService],
})
export class SubscriptionsModule {}
