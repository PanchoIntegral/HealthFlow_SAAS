import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Corrección de los datos de identificación. Todos opcionales: es un PATCH y
 * el campo ausente conserva lo guardado.
 *
 * `fechaNacimiento` SÍ cambia la edad ya impresa en cada receta emitida — pero
 * no la reescribe: `recetas.contenido` es un snapshot congelado (ver 0028), así
 * que las ya emitidas conservan la edad con la que se imprimieron. Corregir
 * aquí solo afecta expediente y recetas futuras.
 *
 * No admite CURP a propósito: tiene control de duplicados y validación de
 * forma propios, es otro caso de uso con sus reglas.
 */
export class UpdatePatientDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  nombre?: string;

  /** Cadena vacía = borrar el teléfono guardado. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  telefono?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fechaNacimiento debe ser YYYY-MM-DD' })
  fechaNacimiento?: string;
}
