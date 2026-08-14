import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  METODOS_PAGO,
  TIPOS_MOVIMIENTO_CAJA,
  type MetodoPago,
  type TipoMovimientoCaja,
} from '@healthflow/shared-types';

/**
 * Tope de $1,000,000.00 (en centavos) para cualquier monto de caja. No es una
 * regla de negocio sino un cinturón contra el dedazo: un cero de más en el
 * fondo inicial descuadra el corte del día entero.
 */
const MAX_CENTAVOS = 100_000_000;

export class AbrirCajaDto {
  /** Fondo de cambio con el que arranca el cajón. Puede ser 0. */
  @IsInt()
  @Min(0)
  @Max(MAX_CENTAVOS)
  fondoInicialCentavos!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notas?: string;
}

export class RegistrarMovimientoCajaDto {
  @IsIn(TIPOS_MOVIMIENTO_CAJA)
  tipo!: TipoMovimientoCaja;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  concepto!: string;

  @IsInt()
  @IsPositive()
  @Max(MAX_CENTAVOS)
  montoCentavos!: number;

  @IsIn(METODOS_PAGO)
  metodo!: MetodoPago;

  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  /** Solo se toma en cuenta en un `ingreso`: genera el abono al presupuesto. */
  @IsOptional()
  @IsUUID()
  presupuestoId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  referencia?: string;
}

/** El `tipo` no se puede corregir: un ingreso mal capturado se cancela. */
export class ActualizarMovimientoCajaDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  concepto?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(MAX_CENTAVOS)
  montoCentavos?: number;

  @IsOptional()
  @IsIn(METODOS_PAGO)
  metodo?: MetodoPago;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  referencia?: string;
}

export class CancelarMovimientoCajaDto {
  /** Obligatorio: un movimiento cancelado sin explicación no sirve al arqueo. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  motivo!: string;
}

export class CerrarCajaDto {
  /** Efectivo físicamente contado en el cajón. Puede ser 0. */
  @IsInt()
  @Min(0)
  @Max(MAX_CENTAVOS)
  efectivoContadoCentavos!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notas?: string;
}

export class RangoCortesDto {
  @IsOptional()
  @IsISO8601()
  desde?: string;

  @IsOptional()
  @IsISO8601()
  hasta?: string;
}
