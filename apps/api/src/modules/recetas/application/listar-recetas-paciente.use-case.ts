import { Inject, Injectable } from '@nestjs/common';
import type { RecetaView } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RECETA_REPOSITORY, type RecetaRepository } from '../domain/receta.repository';

@Injectable()
export class ListarRecetasPacienteUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(RECETA_REPOSITORY) private readonly repo: RecetaRepository,
  ) {}

  execute(patientId: string): Promise<RecetaView[]> {
    return this.tenantDb.run((tx) => this.repo.listarPorPaciente(tx, patientId));
  }
}
