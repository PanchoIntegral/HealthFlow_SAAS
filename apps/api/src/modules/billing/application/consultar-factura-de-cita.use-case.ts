import { Inject, Injectable } from '@nestjs/common';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { FACTURA_REPOSITORY, type FacturaRepository } from '../domain/factura.repository';
import { toFacturaView, type FacturaView } from './factura.views';

/**
 * Estado de facturación de una cita para la UI: la ÚLTIMA factura en cualquier
 * estatus (TIMBRADA → chip verde, ERROR → reintentar, CANCELADA → re-facturar)
 * o null si la cita nunca se ha facturado.
 */
@Injectable()
export class ConsultarFacturaDeCitaUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(FACTURA_REPOSITORY) private readonly facturas: FacturaRepository,
  ) {}

  async execute(appointmentId: string): Promise<FacturaView | null> {
    return this.tenantDb.run(async (tx) => {
      const factura = await this.facturas.findUltimaByAppointment(tx, appointmentId);
      if (!factura) return null;
      const conceptos = await this.facturas.listConceptos(tx, factura.id);
      return toFacturaView(factura, conceptos);
    });
  }
}
