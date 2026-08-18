import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { SEXOS_PACIENTE, type SexoPaciente } from '@healthflow/shared-types';

export class CreatePatientDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  nombre!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fechaNacimiento debe ser YYYY-MM-DD' })
  fechaNacimiento!: string;

  @IsOptional()
  @IsIn(SEXOS_PACIENTE)
  sexo?: SexoPaciente;

  @IsOptional()
  @IsString()
  @MaxLength(18)
  curp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  telefono?: string;
}
