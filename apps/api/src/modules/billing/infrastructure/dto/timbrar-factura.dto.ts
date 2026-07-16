import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * Entrada del timbrado. NUNCA se aceptan subtotal/iva/total del cliente — los
 * totales se derivan de los conceptos en la entidad (el ValidationPipe global
 * corre con whitelist + forbidNonWhitelisted, así que campos extra se rechazan).
 * El tenant tampoco viaja aquí: sale del JWT vía AsyncLocalStorage.
 */
export class ReceptorFiscalDto {
  /** El formato real (regex SAT) lo valida el VO Rfc en dominio. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(13)
  rfc!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  razonSocial!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  regimenFiscal!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5)
  codigoPostal!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4)
  usoCfdi!: string;
}

export class ConceptoDto {
  /** Se valida como string; validar contra el catálogo c_ClaveProdServ del SAT
   *  es mejora pre-producción (el PAC rechaza claves inválidas). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  claveProdServ!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5)
  claveUnidad!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  descripcion!: string;

  @IsNumber()
  @IsPositive()
  cantidad!: number;

  /** Precio unitario en pesos. */
  @IsNumber()
  @IsPositive()
  valorUnitario!: number;

  /** Consulta médica de médico titulado: EXENTO (art. 15 LIVA). */
  @IsOptional()
  @IsIn(['EXENTO', 'TASA_16', 'TASA_0'])
  tratamientoIva?: 'EXENTO' | 'TASA_16' | 'TASA_0';
}

export class TimbrarFacturaDto {
  @IsUUID()
  appointmentId!: string;

  @ValidateNested()
  @Type(() => ReceptorFiscalDto)
  receptor!: ReceptorFiscalDto;

  /** Min 1 (sin factura vacía) y máx 50 (sin payloads absurdos hacia el PAC). */
  @ValidateNested({ each: true })
  @Type(() => ConceptoDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  conceptos!: ConceptoDto[];
}
