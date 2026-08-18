import { Inject, Injectable } from '@nestjs/common';
import type { RecetaDetalle } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RecetaNoEncontradaError } from '../domain/receta.errors';
import { RECETA_REPOSITORY, type RecetaRepository } from '../domain/receta.repository';

@Injectable()
export class GetRecetaDetalleUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(RECETA_REPOSITORY) private readonly repo: RecetaRepository,
  ) {}

  async execute(id: string): Promise<RecetaDetalle> {
    return this.tenantDb.run(async (tx) => {
      const detalle = await this.repo.findDetalleById(tx, id);
      // 404 y no 403 cuando la receta es de otra clínica: RLS la deja
      // invisible, y responder "prohibido" confirmaría que ese folio existe.
      if (!detalle) throw new RecetaNoEncontradaError();
      return detalle;
    });
  }
}
