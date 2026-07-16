import { randomUUID } from 'node:crypto';
import { ConceptoCfdi } from './concepto-cfdi.entity';
import {
  FacturaSinConceptosError,
  TransicionFacturaInvalidaError,
} from './factura.errors';

export type FacturaEstatus = 'PENDIENTE' | 'TIMBRADA' | 'CANCELADA' | 'ERROR';

export interface FacturaProps {
  id: string;
  appointmentId: string;
  emisorId: string;
  receptorId: string;
  estatus: FacturaEstatus;
  uuidFiscal: string | null;
  pacRawId: string | null;
  subtotalCentavos: number;
  ivaCentavos: number;
  totalCentavos: number;
  errorCode: string | null;
  motivoCancelacion: string | null;
  timbradaEn: Date | null;
  canceladaEn: Date | null;
}

/**
 * Entidad de la factura (CFDI 4.0). Concentra dos invariantes no negociables:
 *
 * 1. Máquina de estados PENDIENTE → TIMBRADA → CANCELADA (ERROR como rama
 *    reintentable). Las transiciones se bloquean AQUÍ (`asegurarTransicionDesde`)
 *    para que ninguna capa superior pueda saltarse el flujo — una factura
 *    TIMBRADA es inmutable ante el SAT salvo cancelación con motivo.
 *
 * 2. subtotal/iva/total se calculan SIEMPRE a partir de los conceptos, nunca
 *    se aceptan como input del cliente.
 */
export class Factura {
  private constructor(private readonly props: FacturaProps) {}

  /** Crea una factura PENDIENTE con totales derivados de los conceptos. */
  static crear(input: {
    appointmentId: string;
    emisorId: string;
    receptorId: string;
    conceptos: ConceptoCfdi[];
    id?: string;
  }): Factura {
    if (input.conceptos.length === 0) throw new FacturaSinConceptosError();

    const subtotal = input.conceptos.reduce((sum, c) => sum + c.importeCentavos, 0);
    const iva = input.conceptos.reduce((sum, c) => sum + c.ivaCentavos, 0);

    return new Factura({
      id: input.id ?? randomUUID(),
      appointmentId: input.appointmentId,
      emisorId: input.emisorId,
      receptorId: input.receptorId,
      estatus: 'PENDIENTE',
      uuidFiscal: null,
      pacRawId: null,
      subtotalCentavos: subtotal,
      ivaCentavos: iva,
      totalCentavos: subtotal + iva,
      errorCode: null,
      motivoCancelacion: null,
      timbradaEn: null,
      canceladaEn: null,
    });
  }

  static fromState(props: FacturaProps): Factura {
    return new Factura({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get appointmentId(): string {
    return this.props.appointmentId;
  }
  get emisorId(): string {
    return this.props.emisorId;
  }
  get receptorId(): string {
    return this.props.receptorId;
  }
  get estatus(): FacturaEstatus {
    return this.props.estatus;
  }
  get uuidFiscal(): string | null {
    return this.props.uuidFiscal;
  }
  get pacRawId(): string | null {
    return this.props.pacRawId;
  }
  get subtotalCentavos(): number {
    return this.props.subtotalCentavos;
  }
  get ivaCentavos(): number {
    return this.props.ivaCentavos;
  }
  get totalCentavos(): number {
    return this.props.totalCentavos;
  }
  get errorCode(): string | null {
    return this.props.errorCode;
  }
  get motivoCancelacion(): string | null {
    return this.props.motivoCancelacion;
  }
  get timbradaEn(): Date | null {
    return this.props.timbradaEn;
  }
  get canceladaEn(): Date | null {
    return this.props.canceladaEn;
  }

  /** PENDIENTE → TIMBRADA, con el folio fiscal (UUID) que devolvió el PAC. */
  marcarTimbrada(uuidFiscal: string, pacRawId: string, now: Date = new Date()): void {
    this.asegurarTransicionDesde(['PENDIENTE'], 'TIMBRADA');
    this.props.estatus = 'TIMBRADA';
    this.props.uuidFiscal = uuidFiscal;
    this.props.pacRawId = pacRawId;
    this.props.errorCode = null;
    this.props.timbradaEn = now;
  }

  /** PENDIENTE → ERROR (fallo del PAC; reintentable). */
  marcarError(errorCode: string): void {
    this.asegurarTransicionDesde(['PENDIENTE'], 'ERROR');
    this.props.estatus = 'ERROR';
    this.props.errorCode = errorCode;
  }

  /** ERROR → PENDIENTE (reintento de timbrado). */
  reintentar(): void {
    this.asegurarTransicionDesde(['ERROR'], 'PENDIENTE');
    this.props.estatus = 'PENDIENTE';
    this.props.errorCode = null;
  }

  /** TIMBRADA → CANCELADA, con motivo obligatorio (catálogo SAT 01-04). */
  cancelar(motivo: string, now: Date = new Date()): void {
    this.asegurarTransicionDesde(['TIMBRADA'], 'CANCELADA');
    this.props.estatus = 'CANCELADA';
    this.props.motivoCancelacion = motivo;
    this.props.canceladaEn = now;
  }

  private asegurarTransicionDesde(permitidos: FacturaEstatus[], destino: FacturaEstatus): void {
    if (!permitidos.includes(this.props.estatus)) {
      throw new TransicionFacturaInvalidaError(this.props.estatus, destino);
    }
  }

  toState(): FacturaProps {
    return { ...this.props };
  }
}
