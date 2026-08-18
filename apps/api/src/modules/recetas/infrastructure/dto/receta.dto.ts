import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

class DiagnosticoCie10Dto {
  @IsString() @MaxLength(10) cie10!: string;
  @IsString() @MaxLength(300) descripcion!: string;
}

/**
 * Un medicamento de la receta. La validación de FORMA vive aquí; la de la
 * norma (qué campos son obligatorios según el RIS) vive en `RecetaValidator`,
 * dentro del dominio. Por eso casi todo es opcional en este DTO: un campo
 * vacío tiene que llegar al validador para que reporte su ruta exacta, en vez
 * de rebotar con un 400 genérico de class-validator.
 */
class MedicamentoRecetadoDto {
  @IsOptional() @IsString() @MaxLength(64) clave?: string | null;

  @IsString() @MaxLength(200) denominacionGenerica!: string;

  @IsOptional() @IsString() @MaxLength(200) denominacionDistintiva?: string | null;

  @IsOptional() @IsString() @MaxLength(200) presentacion?: string;
  @IsOptional() @IsString() @MaxLength(120) dosis?: string;
  @IsOptional() @IsString() @MaxLength(60) via?: string;
  @IsOptional() @IsString() @MaxLength(120) frecuencia?: string;
  @IsOptional() @IsString() @MaxLength(120) duracion?: string;
  @IsOptional() @IsString() @MaxLength(500) indicaciones?: string | null;

  /**
   * Se acepta del cliente, pero NO es lo que decide el bloqueo por sí solo:
   * el rango 1-6 solo evita basura. La autoridad es el catálogo, y el use-case
   * la reconcilia contra `medicamentos` antes de validar.
   */
  @IsOptional() @IsInt() @Min(1) @Max(6) fraccion?: number | null;
}

export class EmitirRecetaDto {
  @IsUUID() patientId!: string;

  @IsOptional() @IsUUID() appointmentId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DiagnosticoCie10Dto)
  diagnosticos!: DiagnosticoCie10Dto[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MedicamentoRecetadoDto)
  medicamentos!: MedicamentoRecetadoDto[];

  @IsOptional() @IsString() @MaxLength(2000) indicacionesGenerales?: string;
}

export class CancelarRecetaDto {
  /**
   * Obligatorio y con mínimo: la cancelación queda en el expediente y en la
   * bitácora, y "x" no le dice nada a quien la lea en dos años.
   */
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  motivo!: string;
}
