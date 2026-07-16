import { Inject, Injectable, Logger } from '@nestjs/common';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { AuditService } from '../../../common/audit/audit.service';
import {
  FacturaNoEncontradaError,
  PacCancelacionError,
  TransicionFacturaInvalidaError,
} from '../domain/factura.errors';
import { FACTURA_REPOSITORY, type FacturaRepository } from '../domain/factura.repository';
import { FACTURACION_PAC, type FacturacionPacPort } from '../domain/facturacion-pac.port';
import { toFacturaView, type FacturaView } from './factura.views';

/**
 * Cancelación de una factura TIMBRADA con motivo del catálogo SAT (01-04).
 * La entidad valida la transición (no se puede cancelar lo no timbrado); el PAC
 * se llama fuera de la transacción y el nuevo estatus se persiste después.
 */
@Injectable()
export class CancelarFacturaUseCase {
  private readonly logger = new Logger(CancelarFacturaUseCase.name);

  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    @Inject(FACTURA_REPOSITORY) private readonly facturas: FacturaRepository,
    @Inject(FACTURACION_PAC) private readonly pac: FacturacionPacPort,
  ) {}

  async execute(facturaId: string, motivo: string): Promise<FacturaView> {
    // Fase 1: cargar y validar. RLS + filtro por tenant ⇒ factura ajena = 404.
    const factura = await this.tenantDb.run(async (tx) => {
      const f = await this.facturas.findById(tx, facturaId);
      if (!f) throw new FacturaNoEncontradaError();
      // Valida la transición ANTES de llamar al PAC (falla rápido con 409).
      if (f.estatus !== 'TIMBRADA') {
        throw new TransicionFacturaInvalidaError(f.estatus, 'CANCELADA');
      }
      return f;
    });

    // Fase 2: cancelar ante el SAT vía PAC, sin transacción abierta.
    try {
      await this.pac.cancelar(factura.pacRawId!, motivo);
    } catch {
      this.logger.error(`Cancelación falló para factura ${factura.id}`);
      throw new PacCancelacionError();
    }

    // Fase 3: persistir la cancelación + auditoría (atómico).
    return this.tenantDb.run(async (tx) => {
      factura.cancelar(motivo);
      await this.facturas.updateEstado(tx, factura);
      await this.audit.record(tx, {
        entidad: 'factura',
        entidadId: factura.id,
        accion: 'cancelar',
        detalle: { motivo },
      });
      const conceptos = await this.facturas.listConceptos(tx, factura.id);
      return toFacturaView(factura, conceptos);
    });
  }
}
