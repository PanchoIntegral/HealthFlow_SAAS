import { Inject, Injectable } from '@nestjs/common';
import type { WhatsappConfigView } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import { WhatsappConfig } from '../domain/whatsapp-config.entity';
import {
  WHATSAPP_CONFIG_REPOSITORY,
  type WhatsappConfigRepository,
} from '../domain/whatsapp-config.repository';

/**
 * Configuración de recordatorios para la pantalla de Ajustes.
 *
 * La clínica que nunca ha entrado no tiene fila: se devuelven los valores por
 * defecto en lugar de un 404, para que la pantalla se pinte igual y la fila
 * nazca solo cuando el titular guarde algo.
 */
@Injectable()
export class GetWhatsappConfigUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    @Inject(WHATSAPP_CONFIG_REPOSITORY) private readonly repo: WhatsappConfigRepository,
  ) {}

  async execute(): Promise<WhatsappConfigView> {
    const { tenantId } = this.ctx.get();
    const config = await this.tenantDb.run((tx) => this.repo.find(tx, tenantId));
    return aVista(config ?? WhatsappConfig.porDefecto(tenantId));
  }
}

/**
 * El access token NUNCA sale del backend, ni siquiera parcialmente: la pantalla
 * solo necesita saber si hay uno guardado para decidir entre "Configurar" y
 * "Reemplazar".
 */
export function aVista(config: WhatsappConfig): WhatsappConfigView {
  return {
    modo: config.modo,
    wabaId: config.wabaId,
    phoneNumberId: config.phoneNumberId,
    tieneToken: config.accessTokenCifrado !== null,
    nombreRemitente: config.nombreRemitente,
    activo: config.activo,
    horasAnticipacion: config.horasAnticipacion,
    enviarConfirmacion: config.enviarConfirmacion,
    zonaHoraria: config.zonaHoraria,
    silencioDesde: config.silencioDesde,
    silencioHasta: config.silencioHasta,
    horarioAtencion: config.horarioAtencion,
  };
}
