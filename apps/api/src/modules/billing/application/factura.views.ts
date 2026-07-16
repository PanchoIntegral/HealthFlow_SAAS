import type { FacturaView } from '@healthflow/shared-types';
import type { ConceptoCfdi } from '../domain/concepto-cfdi.entity';
import type { Factura } from '../domain/factura.entity';

// La forma de la respuesta HTTP vive en shared-types (la consume el frontend).
export type { FacturaView };

const pesos = (centavos: number): string => (centavos / 100).toFixed(2);

export function toFacturaView(factura: Factura, conceptos: ConceptoCfdi[]): FacturaView {
  return {
    id: factura.id,
    appointmentId: factura.appointmentId,
    estatus: factura.estatus,
    uuidFiscal: factura.uuidFiscal,
    subtotal: pesos(factura.subtotalCentavos),
    iva: pesos(factura.ivaCentavos),
    total: pesos(factura.totalCentavos),
    motivoCancelacion: factura.motivoCancelacion,
    timbradaEn: factura.timbradaEn ? factura.timbradaEn.toISOString() : null,
    canceladaEn: factura.canceladaEn ? factura.canceladaEn.toISOString() : null,
    conceptos: conceptos.map((c) => ({
      claveProdServ: c.claveProdServ,
      claveUnidad: c.claveUnidad,
      descripcion: c.descripcion,
      cantidad: c.cantidad,
      valorUnitario: pesos(c.valorUnitarioCentavos),
      importe: pesos(c.importeCentavos),
      tratamientoIva: c.tratamientoIva,
    })),
  };
}
