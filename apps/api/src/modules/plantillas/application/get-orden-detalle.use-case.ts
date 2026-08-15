import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { OrdenPlantillasDetalle } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import {
  ORDEN_PLANTILLAS_REPOSITORY,
  type OrdenPlantillasRepository,
} from '../domain/orden-plantillas.repository';

/**
 * Detalle completo de una orden (con nombres), para la vista de impresión.
 * Se busca por ID de la orden y no por cita: la impresión se pide desde el
 * expediente del paciente igual que desde la consulta que la originó, y el
 * expediente no siempre tiene a mano un appointmentId.
 */
@Injectable()
export class GetOrdenDetalleUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(ORDEN_PLANTILLAS_REPOSITORY) private readonly ordenes: OrdenPlantillasRepository,
  ) {}

  async execute(id: string): Promise<OrdenPlantillasDetalle> {
    return this.tenantDb.run(async (tx) => {
      const detalle = await this.ordenes.findDetalleById(tx, id);
      if (!detalle) throw new NotFoundException('Orden de plantillas no encontrada');
      return detalle;
    });
  }
}
