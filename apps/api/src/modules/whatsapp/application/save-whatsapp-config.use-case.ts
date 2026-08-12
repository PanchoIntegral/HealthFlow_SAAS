import { Inject, Injectable } from '@nestjs/common';
import type { SaveWhatsappConfigRequest, WhatsappConfigView } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import { AuditService } from '../../../common/audit/audit.service';
import { SecretosService } from '../../../common/crypto/secretos.service';
import { WhatsappConfig } from '../domain/whatsapp-config.entity';
import {
  WHATSAPP_CONFIG_REPOSITORY,
  type WhatsappConfigRepository,
} from '../domain/whatsapp-config.repository';
import { aVista } from './get-whatsapp-config.use-case';

@Injectable()
export class SaveWhatsappConfigUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    private readonly audit: AuditService,
    private readonly secretos: SecretosService,
    @Inject(WHATSAPP_CONFIG_REPOSITORY) private readonly repo: WhatsappConfigRepository,
  ) {}

  async execute(input: SaveWhatsappConfigRequest): Promise<WhatsappConfigView> {
    const { tenantId } = this.ctx.get();

    return this.tenantDb.run(async (tx) => {
      const actual = (await this.repo.find(tx, tenantId)) ?? WhatsappConfig.porDefecto(tenantId);

      const { accessToken, ...resto } = input;
      // Las claves ausentes se descartan en vez de propagarse como `undefined`:
      // class-transformer instancia el DTO con TODAS sus propiedades declaradas,
      // así que un spread directo escribiría `undefined` encima de lo guardado y
      // cambiar las horas de anticipación borraría el resto de la configuración.
      const cambios: Parameters<WhatsappConfig['actualizar']>[0] = Object.fromEntries(
        Object.entries(resto).filter(([, valor]) => valor !== undefined),
      );

      // El token llega en claro una sola vez y se cifra antes de tocar la base.
      // `undefined` = "no lo tocan"; `null` = "bórralo". Distinguirlos importa:
      // guardar la pantalla para cambiar las horas de anticipación no debe
      // borrar el token que ya estaba configurado.
      if (accessToken !== undefined) {
        cambios.accessTokenCifrado = accessToken
          ? this.secretos.cifrar(accessToken, tenantId)
          : null;
      }

      const siguiente = actual.actualizar(cambios);
      await this.repo.save(tx, siguiente);

      await this.audit.record(tx, {
        entidad: 'whatsapp_config',
        entidadId: tenantId,
        accion: 'update',
        // Nunca el token, ni cifrado: la bitácora la lee gente y se exporta.
        detalle: {
          modo: siguiente.modo,
          activo: siguiente.activo,
          horasAnticipacion: siguiente.horasAnticipacion,
          enviarConfirmacion: siguiente.enviarConfirmacion,
          tokenModificado: accessToken !== undefined,
        },
      });

      return aVista(siguiente);
    });
  }
}
