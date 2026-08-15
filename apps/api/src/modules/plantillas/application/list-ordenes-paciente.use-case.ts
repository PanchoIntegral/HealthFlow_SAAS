import { Inject, Injectable } from '@nestjs/common';
import type { OrdenPlantillasView } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import {
  ORDEN_PLANTILLAS_REPOSITORY,
  type OrdenPlantillasRepository,
} from '../domain/orden-plantillas.repository';

/** Todas las órdenes de plantillas de un paciente, para el expediente. */
@Injectable()
export class ListOrdenesPacienteUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(ORDEN_PLANTILLAS_REPOSITORY) private readonly ordenes: OrdenPlantillasRepository,
  ) {}

  execute(patientId: string): Promise<OrdenPlantillasView[]> {
    return this.tenantDb.run((tx) => this.ordenes.listarPorPaciente(tx, patientId));
  }
}
