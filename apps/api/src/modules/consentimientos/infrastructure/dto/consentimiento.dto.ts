import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CrearConsentimientoDto {
  @IsUUID()
  patientId!: string;

  @IsOptional()
  @IsUUID()
  presupuestoId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  procedimiento!: string;

  /** Riesgos, alternativas e indicaciones explicadas al paciente. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  contenido!: string;
}
