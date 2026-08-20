import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ActualizarDatosClinicaDto {
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
}
