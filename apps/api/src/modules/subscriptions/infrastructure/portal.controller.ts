import { Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../../auth/casl/policies.guard';
import { PermitirSinSuscripcion } from '../../../common/subscription/permitir-sin-suscripcion.decorator';
import { CreatePortalSessionUseCase } from '../application/create-portal-session.use-case';

/**
 * Portal de facturación de Stripe para la clínica autenticada.
 *
 * @PermitirSinSuscripcion es lo importante aquí: este endpoint tiene que
 * funcionar JUSTAMENTE cuando la cuenta está suspendida, porque es como se
 * deja de estarlo. Sin la exención, el gating encerraría al usuario.
 *
 * `read` sobre 'Cuenta' lo restringe al TITULAR, igual que la pantalla de
 * facturación. Antes bastaba con estar autenticado, así que un asistente podía
 * abrir el portal y ver las facturas y la tarjeta de la clínica — dinero que
 * no es asunto suyo, y que contradecía lo que ya decía la fábrica de CASL
 * ("administrar la suscripción es del dueño de la cuenta").
 *
 * Rate-limited igual que el checkout: cada llamada crea una sesión real.
 */
@Controller('subscriptions')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class PortalController {
  constructor(private readonly createPortalSession: CreatePortalSessionUseCase) {}

  @Post('portal-session')
  @RequirePolicy('read', 'Cuenta')
  @PermitirSinSuscripcion()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  portalSession(): Promise<{ url: string }> {
    return this.createPortalSession.execute();
  }
}
