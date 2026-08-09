import { Controller, Get, UseGuards } from '@nestjs/common';
import type { FacturacionView } from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../../auth/casl/policies.guard';
import { PermitirSinSuscripcion } from '../../../common/subscription/permitir-sin-suscripcion.decorator';
import { GetFacturacionUseCase } from '../application/get-facturacion.use-case';

/**
 * Facturación de la clínica: plan, tarjeta e historial de cobros.
 *
 * `read` sobre 'Cuenta' es lo que lo restringe al TITULAR: en la fábrica de
 * CASL, 'Cuenta' no tiene ningún `can` explícito, así que solo lo alcanza el
 * rol 'admin' por su `manage all`. Un médico contratado o el asistente reciben
 * 403 — lo que paga la clínica no es asunto suyo.
 *
 * @PermitirSinSuscripcion por el mismo motivo que el portal: si la cuenta está
 * suspendida por impago, esta es justo la pantalla que el titular necesita
 * poder abrir para entender por qué y arreglarlo. (De todas formas es un GET,
 * que el gating ya deja pasar; se declara para que un cambio futuro a POST no
 * lo encierre por accidente.)
 */
@Controller('subscriptions')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class FacturacionController {
  constructor(private readonly getFacturacion: GetFacturacionUseCase) {}

  @Get('facturacion')
  @RequirePolicy('read', 'Cuenta')
  @PermitirSinSuscripcion()
  facturacion(): Promise<FacturacionView> {
    return this.getFacturacion.execute();
  }
}
