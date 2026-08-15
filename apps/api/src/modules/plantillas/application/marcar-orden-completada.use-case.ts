import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { AuditService } from '../../../common/audit/audit.service';
import {
  ORDEN_PLANTILLAS_REPOSITORY,
  type OrdenPlantillasRepository,
} from '../domain/orden-plantillas.repository';

/**
 * Marca la orden como completada, por SU PROPIO id (ver `SaveOrdenDraftUseCase`
 * para por qué ya no va por cita).
 *
 * No es una integración real con el laboratorio —HealthFlow no manda nada por
 * su cuenta— sino un lugar donde el médico deja constancia de que terminó de
 * llenarla y ya está lista para imprimirse y entregarse.
 */
@Injectable()
export class MarcarOrdenCompletadaUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    @Inject(ORDEN_PLANTILLAS_REPOSITORY) private readonly ordenes: OrdenPlantillasRepository,
  ) {}

  execute(id: string): Promise<void> {
    return this.tenantDb.run(async (tx) => {
      const existente = await this.ordenes.findById(tx, id);
      if (!existente) throw new NotFoundException('Orden de plantillas no encontrada');

      await this.ordenes.setEstatus(tx, id, 'completada');
      await this.audit.record(tx, {
        entidad: 'orden_plantillas',
        entidadId: id,
        accion: 'marcar_completada',
        detalle: { patientId: existente.patientId },
      });
    });
  }
}
