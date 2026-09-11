import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { FEATURE_FLAGS } from '@healthflow/shared-types';

export class CambiarModuloDto {
  @IsIn(FEATURE_FLAGS as unknown as string[], { message: 'Módulo desconocido' })
  flag!: string;

  @IsBoolean()
  habilitado!: boolean;

  /** Por qué se activó/desactivó. Nunca datos de pacientes. */
  @IsOptional()
  @IsString()
  @MaxLength(280)
  notas?: string;
}
