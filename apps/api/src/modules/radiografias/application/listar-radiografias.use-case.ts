import { Inject, Injectable } from '@nestjs/common';
import type { RadiografiaView } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { ALMACENAMIENTO_PORT, type AlmacenamientoPort } from '../domain/almacenamiento.port';
import { RADIOGRAFIA_REPOSITORY, type RadiografiaRepository } from '../domain/radiografia.repository';

@Injectable()
export class ListarRadiografiasUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(ALMACENAMIENTO_PORT) private readonly storage: AlmacenamientoPort,
    @Inject(RADIOGRAFIA_REPOSITORY) private readonly repo: RadiografiaRepository,
  ) {}

  async execute(patientId: string): Promise<RadiografiaView[]> {
    const rows = await this.tenantDb.run((tx) => this.repo.listarPorPaciente(tx, patientId));

    // Las URLs se firman fuera de la transacción de DB: es una llamada de red
    // al storage, no tiene por qué mantener abierta la conexión a Postgres.
    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        patientId: row.patientId,
        url: await this.storage.presignedGetUrl(row.storageKey),
        mimeType: row.mimeType,
        subidoPorNombre: row.subidoPorNombre,
        createdAt: row.createdAt,
      })),
    );
  }
}
