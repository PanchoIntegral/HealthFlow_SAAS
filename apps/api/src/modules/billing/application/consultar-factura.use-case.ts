import { Inject, Injectable } from '@nestjs/common';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { FacturaNoEncontradaError } from '../domain/factura.errors';
import { FACTURA_REPOSITORY, type FacturaRepository } from '../domain/factura.repository';
import { toFacturaView, type FacturaView } from './factura.views';

/** Lectura de una factura con sus conceptos. RLS + filtro ⇒ ajena = 404. */
@Injectable()
export class ConsultarFacturaUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(FACTURA_REPOSITORY) private readonly facturas: FacturaRepository,
  ) {}

  async execute(facturaId: string): Promise<FacturaView> {
    return this.tenantDb.run(async (tx) => {
      const factura = await this.facturas.findById(tx, facturaId);
      if (!factura) throw new FacturaNoEncontradaError();
      const conceptos = await this.facturas.listConceptos(tx, factura.id);
      return toFacturaView(factura, conceptos);
    });
  }
}
