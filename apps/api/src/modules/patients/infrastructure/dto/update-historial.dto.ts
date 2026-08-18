import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  SEVERIDADES_ALERGIA,
  SEXOS_PACIENTE,
  TIPOS_ALERGIA,
  type SeveridadAlergia,
  type SexoPaciente,
  type TipoAlergia,
} from '@healthflow/shared-types';

export class AlergiaDto {
  @IsString()
  @MaxLength(120)
  sustancia!: string;

  @IsIn(TIPOS_ALERGIA)
  tipo!: TipoAlergia;

  @IsIn(SEVERIDADES_ALERGIA)
  severidad!: SeveridadAlergia;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notas?: string;
}

export class AntecedentesDto {
  /**
   * Claves de BANDERAS_CLINICAS. No se validan contra el catálogo a propósito:
   * si una bandera se retira, los pacientes que ya la tenían deben seguir
   * guardándose sin error. La UI ignora las claves que no reconoce.
   */
  @IsArray()
  @IsString({ each: true })
  banderas!: string[];

  @IsOptional() @IsString() @MaxLength(4000) patologicos?: string;
  @IsOptional() @IsString() @MaxLength(4000) quirurgicos?: string;
  @IsOptional() @IsString() @MaxLength(4000) medicamentosActuales?: string;
  @IsOptional() @IsString() @MaxLength(4000) familiares?: string;
}

export class UpdateHistorialDto {
  @IsBoolean()
  sinAlergiasConocidas!: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AlergiaDto)
  alergias!: AlergiaDto[];

  @ValidateNested()
  @Type(() => AntecedentesDto)
  antecedentes!: AntecedentesDto;

  /**
   * Opcional a diferencia del resto del cuerpo: omitirlo conserva el valor
   * guardado (ver el COALESCE del repositorio). Es lo que permite capturar
   * solo el sexo desde el modal de receta.
   */
  @IsOptional()
  @IsIn(SEXOS_PACIENTE)
  sexo?: SexoPaciente;
}
