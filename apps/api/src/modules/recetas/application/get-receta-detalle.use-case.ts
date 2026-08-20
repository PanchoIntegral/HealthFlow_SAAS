import { Inject, Injectable } from '@nestjs/common';
import type { RecetaDetalle } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { ALMACENAMIENTO_PORT, type AlmacenamientoPort } from '../../radiografias/domain/almacenamiento.port';
import { RecetaNoEncontradaError } from '../domain/receta.errors';
import { RECETA_REPOSITORY, type RecetaRepository } from '../domain/receta.repository';

@Injectable()
export class GetRecetaDetalleUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(RECETA_REPOSITORY) private readonly repo: RecetaRepository,
    @Inject(ALMACENAMIENTO_PORT) private readonly storage: AlmacenamientoPort,
  ) {}

  async execute(id: string): Promise<RecetaDetalle> {
    return this.tenantDb.run(async (tx) => {
      const detalle = await this.repo.findDetalleById(tx, id);
      // 404 y no 403 cuando la receta es de otra clínica: RLS la deja
      // invisible, y responder "prohibido" confirmaría que ese folio existe.
      if (!detalle) throw new RecetaNoEncontradaError();

      // El snapshot congeló la CLAVE de storage, no una URL: se resuelve una
      // firmada fresca en cada lectura (la firmada al emitir ya habría
      // expirado hace mucho para cualquier receta con más de unos minutos).
      const logoStorageKey = detalle.contenido.emisor.logoStorageKey;
      if (logoStorageKey) {
        const logoUrl = await this.storage.presignedGetUrl(logoStorageKey);
        return {
          ...detalle,
          contenido: {
            ...detalle.contenido,
            emisor: { ...detalle.contenido.emisor, logoUrl },
          },
        };
      }
      return detalle;
    });
  }
}
