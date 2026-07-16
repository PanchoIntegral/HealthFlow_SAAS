/**
 * Renglón del CFDI. Los montos se manejan en CENTAVOS (enteros) dentro del
 * dominio para evitar errores de punto flotante; la conversión a decimales
 * (numeric de Postgres / JSON del PAC) vive en los adaptadores.
 *
 * `importe` e `iva` son SIEMPRE calculados — nunca se aceptan como input del
 * cliente (un total manipulable permitiría facturar por debajo del monto real).
 */

export type TratamientoIva = 'EXENTO' | 'TASA_16' | 'TASA_0';

export const TASA_IVA_16 = 0.16;

export interface ConceptoCfdiProps {
  claveProdServ: string;
  claveUnidad: string;
  descripcion: string;
  /** Cantidad (puede ser fraccionaria, p.ej. 1.5 horas). */
  cantidad: number;
  /** Precio unitario en centavos. */
  valorUnitarioCentavos: number;
  /** Consulta médica suele ser EXENTO (art. 15 LIVA). */
  tratamientoIva: TratamientoIva;
}

export class ConceptoCfdi {
  constructor(private readonly props: ConceptoCfdiProps) {}

  get claveProdServ(): string {
    return this.props.claveProdServ;
  }
  get claveUnidad(): string {
    return this.props.claveUnidad;
  }
  get descripcion(): string {
    return this.props.descripcion;
  }
  get cantidad(): number {
    return this.props.cantidad;
  }
  get valorUnitarioCentavos(): number {
    return this.props.valorUnitarioCentavos;
  }
  get tratamientoIva(): TratamientoIva {
    return this.props.tratamientoIva;
  }

  /** Importe en centavos: cantidad × valor unitario, redondeado al centavo. */
  get importeCentavos(): number {
    return Math.round(this.props.cantidad * this.props.valorUnitarioCentavos);
  }

  /** IVA del concepto en centavos según su tratamiento. */
  get ivaCentavos(): number {
    if (this.props.tratamientoIva !== 'TASA_16') return 0;
    return Math.round(this.importeCentavos * TASA_IVA_16);
  }
}
