import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  ESTATUS_PARTIDA,
  ESTATUS_PRESUPUESTO,
  METODOS_PAGO,
  type EstatusPartida,
  type EstatusPresupuesto,
  type MetodoPago,
} from '@healthflow/shared-types';

export class NuevaPartidaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  descripcion!: string;

  /** Notación FDI. No se valida contra el catálogo de piezas: el rango depende
   *  de la dentición y una pieza desconocida no puede hacer daño. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(32)
  piezas?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  fase?: number;

  @IsNumber()
  @IsPositive()
  cantidad!: number;

  /**
   * En CENTAVOS enteros. Nunca se acepta el importe ni el total: se derivan en
   * la entidad, porque un total manipulable permitiría cotizar por debajo de
   * lo que suman las partidas.
   */
  @IsInt()
  @Min(0)
  valorUnitarioCentavos!: number;

  /**
   * Tipo de control que se abre al terminar esta partida. Opcional: sin él no
   * se genera seguimiento. Que el tipo exista y sea de esta clínica lo
   * comprueba el trigger de 0050, no una consulta desde aquí.
   */
  @IsOptional()
  @IsUUID()
  recallTypeId?: string | null;
}

export class CrearPresupuestoDto {
  @IsUUID()
  patientId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  titulo!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notas?: string;

  @IsOptional()
  @IsISO8601()
  vigenciaHasta?: string;

  @ValidateNested({ each: true })
  @Type(() => NuevaPartidaDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  partidas!: NuevaPartidaDto[];
}

export class ReemplazarPartidasDto {
  @ValidateNested({ each: true })
  @Type(() => NuevaPartidaDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  partidas!: NuevaPartidaDto[];
}

export class CambiarEstatusDto {
  @IsIn(ESTATUS_PRESUPUESTO)
  estatus!: EstatusPresupuesto;
}

export class CambiarEstatusPartidaDto {
  @IsIn(ESTATUS_PARTIDA)
  estatus!: EstatusPartida;

  /** Cita donde se ejecutó; de ahí salen los conceptos del CFDI. */
  @IsOptional()
  @IsUUID()
  appointmentId?: string;
}

export class RegistrarAbonoDto {
  @IsInt()
  @IsPositive()
  montoCentavos!: number;

  @IsIn(METODOS_PAGO)
  metodo!: MetodoPago;

  @IsOptional()
  @IsISO8601()
  fecha?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  referencia?: string;
}
