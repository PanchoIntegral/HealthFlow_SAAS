import { Inject, Injectable } from '@nestjs/common';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import {
  PRESUPUESTO_REPOSITORY,
  type PresupuestoRepository,
} from '../domain/presupuesto.repository';

/**
 * Clave del SAT para servicios odontológicos (c_ClaveProdServ) y unidad de
 * servicio. Viven aquí y no en el dominio del presupuesto porque son un
 * detalle FISCAL: el presupuesto cotiza trabajo, no sabe de catálogos del SAT.
 */
const CLAVE_PROD_SERV_ODONTOLOGIA = '85121800';
const CLAVE_UNIDAD_SERVICIO = 'E48';

/** Concepto listo para alimentar TimbrarFacturaDto, sin tocar el timbrado. */
export interface ConceptoSugerido {
  claveProdServ: string;
  claveUnidad: string;
  descripcion: string;
  cantidad: number;
  /** En PESOS: es lo que espera el DTO de facturación. */
  valorUnitario: number;
  tratamientoIva: 'EXENTO';
}

/**
 * Traduce el trabajo dental YA TERMINADO en una cita a conceptos de CFDI.
 *
 * Es el único punto de contacto entre presupuestos y facturación, y va en una
 * sola dirección: el panel de factura pide una sugerencia y la precarga. El
 * timbrado no cambia en absoluto — sigue recibiendo conceptos como siempre,
 * así que este puente no puede romper lo fiscal.
 */
@Injectable()
export class ConceptosParaFacturaUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(PRESUPUESTO_REPOSITORY) private readonly repo: PresupuestoRepository,
  ) {}

  execute(appointmentId: string): Promise<ConceptoSugerido[]> {
    return this.tenantDb.run(async (tx) => {
      const presupuesto = await this.repo.findPorCitaConPartidasTerminadas(tx, appointmentId);
      if (!presupuesto) return [];

      return presupuesto.partidasFacturablesDe(appointmentId).map((p) => ({
        claveProdServ: CLAVE_PROD_SERV_ODONTOLOGIA,
        claveUnidad: CLAVE_UNIDAD_SERVICIO,
        // Incluir las piezas hace la factura auditable frente al expediente.
        descripcion: p.piezas.length
          ? `${p.descripcion} (piezas ${p.piezas.join(', ')})`
          : p.descripcion,
        cantidad: p.cantidad,
        // Centavos → pesos en el borde, como el resto de los adaptadores.
        valorUnitario: p.valorUnitarioCentavos / 100,
        // Servicio prestado por profesional titulado: exento de IVA
        // (art. 15 LIVA), igual que la consulta médica.
        tratamientoIva: 'EXENTO' as const,
      }));
    });
  }
}
