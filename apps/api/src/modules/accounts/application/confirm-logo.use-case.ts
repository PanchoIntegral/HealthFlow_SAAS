import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { ConfirmLogoRequest, LogoClinicaView } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import { AuditService } from '../../../common/audit/audit.service';
import { ALMACENAMIENTO_PORT, type AlmacenamientoPort } from '../../radiografias/domain/almacenamiento.port';
import { DatosClinicaReader } from './datos-clinica.reader';

const MAX_BYTES_LOGO = 10 * 1024 * 1024;

/**
 * Registra en `tenants` el logo que YA se subió a storage (paso de
 * confirmación tras la subida directa) — mismo patrón que
 * ConfirmRadiografiaUseCase. Reemplaza el logo anterior si existía: solo hay
 * UNO por clínica, no una galería.
 */
@Injectable()
export class ConfirmLogoUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    private readonly audit: AuditService,
    private readonly datosClinica: DatosClinicaReader,
    @Inject(ALMACENAMIENTO_PORT) private readonly storage: AlmacenamientoPort,
  ) {}

  async execute(input: ConfirmLogoRequest): Promise<LogoClinicaView> {
    const { tenantId } = this.ctx.get();
    const prefijoEsperado = `tenant/${tenantId}/logo/`;
    if (!input.storageKey.startsWith(prefijoEsperado)) {
      throw new BadRequestException('storageKey no corresponde a esta clínica');
    }

    // Mismo criterio que ConfirmRadiografiaUseCase: no registrar un logo que
    // no llegó al storage, ni uno que exceda el tope (ya no lo impone la firma).
    const objeto = await this.storage.verificarObjeto(input.storageKey);
    if (!objeto.existe) {
      throw new BadRequestException('La imagen no llegó al almacenamiento. Vuelve a intentarlo.');
    }
    if (objeto.tamanoBytes !== undefined && objeto.tamanoBytes > MAX_BYTES_LOGO) {
      await this.storage.eliminar(input.storageKey);
      throw new BadRequestException('El logo no puede superar 10MB.');
    }

    return this.tenantDb.run(async (tx) => {
      const anterior = await this.datosClinica.leer(tx);

      await tx.execute(sql`UPDATE tenants SET logo_storage_key = ${input.storageKey}`);

      // El logo anterior se borra DESPUÉS de confirmar el nuevo: si el borrado
      // fallara, preferimos un objeto huérfano en storage a dejar la clínica
      // sin logo por un error de red ajeno a lo que el usuario pidió.
      if (anterior.logoStorageKey) {
        await this.storage.eliminar(anterior.logoStorageKey);
      }

      await this.audit.record(tx, {
        entidad: 'tenant',
        accion: 'actualizar_logo',
        detalle: { storageKey: input.storageKey },
      });

      const url = await this.storage.presignedGetUrl(input.storageKey);
      return { url };
    });
  }
}
