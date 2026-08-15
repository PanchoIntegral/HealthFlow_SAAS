import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { OrdenPlantillasContent } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import {
  ORDEN_PLANTILLAS_REPOSITORY,
  type OrdenPlantillasRepository,
} from '../domain/orden-plantillas.repository';

/**
 * Autosave del contenido de la orden, por SU PROPIO id.
 *
 * Va por id y no por cita a propósito: la orden se puede seguir llenando
 * desde el expediente del paciente, donde no hay ningún `appointmentId` a la
 * mano (no se está viendo ninguna consulta en curso). El modal de la consulta
 * usa `GetOrCreateOrdenPlantillasUseCase` para resolver el id la primera vez;
 * de ahí en adelante, cualquier pantalla que ya conozca el id guarda igual.
 */
@Injectable()
export class SaveOrdenDraftUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(ORDEN_PLANTILLAS_REPOSITORY) private readonly ordenes: OrdenPlantillasRepository,
  ) {}

  execute(id: string, contenido: OrdenPlantillasContent): Promise<void> {
    return this.tenantDb.run(async (tx) => {
      const existente = await this.ordenes.findById(tx, id);
      if (!existente) throw new NotFoundException('Orden de plantillas no encontrada');
      await this.ordenes.saveContent(tx, id, contenido);
    });
  }
}
