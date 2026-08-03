import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ESPECIALIDADES, type EspecialidadKey } from '@healthflow/shared-types';

export class UpdateEspecialidadDto {
  @IsIn(ESPECIALIDADES)
  especialidadKey!: EspecialidadKey;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  especialidad?: string;
}
