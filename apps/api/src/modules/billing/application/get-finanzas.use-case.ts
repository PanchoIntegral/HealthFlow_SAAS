import { Inject, Injectable } from '@nestjs/common';
import type { FinanzasResumen } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { FACTURA_REPOSITORY, type FacturaRepository } from '../domain/factura.repository';

const MAX_FACTURAS = 100;

/**
 * Resumen financiero del consultorio: KPIs de ingreso (solo facturas TIMBRADAS
 * cuentan — las canceladas se reportan aparte), ingresos por mes y el listado
 * de facturas. Acceso restringido por CASL a médico/admin (subject Finanzas).
 */
@Injectable()
export class GetFinanzasUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(FACTURA_REPOSITORY) private readonly facturas: FacturaRepository,
  ) {}

  /** @param mes 'YYYY-MM' opcional; sin él, el mes en curso. */
  execute(mes?: string): Promise<FinanzasResumen> {
    // Ancla al primer día del mes — formato ya validado por el controller.
    const ancla = `${mes ?? new Date().toISOString().slice(0, 7)}-01`;
    return this.tenantDb.run(async (tx) => {
      const [totales, facturas] = [
        await this.facturas.totalesFinanzas(tx, ancla),
        await this.facturas.listFacturas(tx, MAX_FACTURAS, ancla),
      ];
      return { ...totales, facturas };
    });
  }
}
