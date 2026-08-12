import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { WhatsappConfigView, WhatsappConsumoMes } from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../../auth/casl/policies.guard';
import { GetWhatsappConfigUseCase } from '../application/get-whatsapp-config.use-case';
import { SaveWhatsappConfigUseCase } from '../application/save-whatsapp-config.use-case';
import { ConsumoWhatsappUseCase } from '../application/consumo-whatsapp.use-case';
import { SaveWhatsappConfigDto } from './dto/save-whatsapp-config.dto';

/**
 * Configuración de los recordatorios por WhatsApp.
 *
 * Exige `manage` sobre 'Cuenta', igual que la pantalla de facturación: quién
 * paga los mensajes y con qué número salen es decisión del titular, no de un
 * médico dado de alta.
 */
@Controller('whatsapp/config')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class WhatsappConfigController {
  constructor(
    private readonly getConfig: GetWhatsappConfigUseCase,
    private readonly saveConfig: SaveWhatsappConfigUseCase,
    private readonly consumo: ConsumoWhatsappUseCase,
  ) {}

  @Get()
  @RequirePolicy('manage', 'Cuenta')
  get(): Promise<WhatsappConfigView> {
    return this.getConfig.execute();
  }

  /**
   * Límite propio y estrecho: por aquí pasa el access token de la clínica, y
   * no hay ningún flujo legítimo que guarde esta pantalla más de un puñado de
   * veces por minuto.
   */
  @Put()
  @RequirePolicy('manage', 'Cuenta')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  save(@Body() dto: SaveWhatsappConfigDto): Promise<WhatsappConfigView> {
    return this.saveConfig.execute(dto);
  }

  /** Mensajes por mes: lo que determina la factura de WhatsApp de la clínica. */
  @Get('consumo')
  @RequirePolicy('manage', 'Cuenta')
  getConsumo(): Promise<WhatsappConsumoMes[]> {
    return this.consumo.execute();
  }
}
