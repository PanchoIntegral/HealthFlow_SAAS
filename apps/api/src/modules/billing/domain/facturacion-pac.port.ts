import type { TratamientoIva } from './concepto-cfdi.entity';

/**
 * Puerto del PAC (proveedor autorizado de certificación). Punto de extensión
 * para cambiar de proveedor: cualquier campo aquí debe tener sentido para
 * CUALQUIER PAC, no solo el actual (Facturapi). Los montos van en centavos —
 * cada adaptador convierte al formato de su proveedor.
 */

export interface TimbradoEmisor {
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  codigoPostal: string;
}

export interface TimbradoReceptor {
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  codigoPostal: string;
  usoCfdi: string;
}

export interface TimbradoConcepto {
  claveProdServ: string;
  claveUnidad: string;
  descripcion: string;
  cantidad: number;
  valorUnitarioCentavos: number;
  importeCentavos: number;
  tratamientoIva: TratamientoIva;
}

export interface TimbradoRequest {
  /** Id interno de la factura — para correlación en logs, NO PII. */
  facturaId: string;
  emisor: TimbradoEmisor;
  receptor: TimbradoReceptor;
  conceptos: TimbradoConcepto[];
  subtotalCentavos: number;
  ivaCentavos: number;
  totalCentavos: number;
}

export interface TimbradoResult {
  /** Folio fiscal (UUID) asignado por el SAT. */
  uuidFiscal: string;
  /** Id de la factura en el sistema del PAC (para cancelar/consultar). */
  pacRawId: string;
}

export type PacEstatus = 'vigente' | 'cancelada' | 'desconocido';

export interface FacturacionPacPort {
  /** Timbra el CFDI. Lanza PacTimbradoError en fallo (tras reintentos). */
  timbrar(req: TimbradoRequest): Promise<TimbradoResult>;

  /** Solicita la cancelación ante el SAT con motivo del catálogo (01-04). */
  cancelar(pacRawId: string, motivo: string): Promise<void>;

  consultarEstatus(pacRawId: string): Promise<PacEstatus>;
}

export const FACTURACION_PAC = Symbol('FACTURACION_PAC');
