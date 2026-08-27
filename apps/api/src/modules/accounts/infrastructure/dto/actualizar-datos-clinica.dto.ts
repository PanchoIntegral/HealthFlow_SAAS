import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { TAMANOS_LOGO, type TamanoLogo } from '@healthflow/shared-types';

/**
 * Apariencia de la receta. Se valida campo por campo y no como jsonb libre:
 * lo que entre aquí se guarda tal cual y se imprime en un documento legal.
 */
export class ConfigRecetaDto {
  @IsIn(TAMANOS_LOGO)
  logoTamano!: TamanoLogo;

  @IsBoolean()
  mostrarEspecialidad!: boolean;

  @IsBoolean()
  mostrarLeyendaPie!: boolean;

  /**
   * Hexadecimal de 6 dígitos, o null para el gris por omisión. Lista cerrada
   * de formato —no `color: red` ni `var(--x)`— porque este valor termina en un
   * atributo `style` del documento impreso.
   */
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'El color debe ser hexadecimal, p.ej. #1d4ed8' })
  colorAcento!: string | null;

  @IsBoolean()
  papelMembretado!: boolean;
}

export class ActualizarDatosClinicaDto {
  /**
   * Nombre del establecimiento en el membrete (art. 64 del RIS). A diferencia
   * del resto, la cadena vacía NO borra: se conserva el anterior.
   */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nombreClinica?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  direccion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  telefono?: string;

  /** Texto libre para el pie de la receta impresa. Cadena vacía = borrar. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  leyendaPie?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConfigRecetaDto)
  configReceta?: ConfigRecetaDto;
}
