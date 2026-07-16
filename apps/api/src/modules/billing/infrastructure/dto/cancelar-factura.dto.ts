import { IsIn } from 'class-validator';

/**
 * Cancelación con motivo OBLIGATORIO del catálogo SAT:
 *  01 comprobante emitido con errores CON relación
 *  02 comprobante emitido con errores SIN relación
 *  03 no se llevó a cabo la operación
 *  04 operación nominativa relacionada en factura global
 */
export class CancelarFacturaDto {
  @IsIn(['01', '02', '03', '04'])
  motivo!: '01' | '02' | '03' | '04';
}
