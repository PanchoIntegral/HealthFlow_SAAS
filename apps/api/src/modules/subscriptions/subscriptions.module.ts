import { Module } from '@nestjs/common';
import { CaslModule } from '../auth/casl/casl.module';
import { CheckoutController } from './infrastructure/checkout.controller';
import { PortalController } from './infrastructure/portal.controller';
import { FacturacionController } from './infrastructure/facturacion.controller';
import { StripeWebhookController } from './infrastructure/stripe-webhook.controller';
import { StripeService } from './infrastructure/stripe.service';
import { CreateCheckoutSessionUseCase } from './application/create-checkout-session.use-case';
import { CreatePortalSessionUseCase } from './application/create-portal-session.use-case';
import { GetFacturacionUseCase } from './application/get-facturacion.use-case';
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
  // CaslModule y no AuthModule: AuthModule ya importa este módulo, así que
  // importarlo de vuelta sería un ciclo. FacturacionController solo necesita
  // la fábrica de permisos, que es justo lo que CaslModule aporta.
  imports: [CaslModule],
  controllers: [
    CheckoutController,
    PortalController,
    FacturacionController,
    StripeWebhookController,
  ],
  providers: [
    StripeService,
    CreateCheckoutSessionUseCase,
    CreatePortalSessionUseCase,
    GetFacturacionUseCase,
    HandleStripeWebhookUseCase,
    OnboardingTicketsService,
  ],
  exports: [OnboardingTicketsService],
})
export class SubscriptionsModule {}
