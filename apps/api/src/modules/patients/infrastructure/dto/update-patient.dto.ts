import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Corrección de los datos de identificación. Ambos opcionales: es un PATCH y
 * el campo ausente conserva lo guardado.
 *
 * No admite fecha de nacimiento ni CURP a propósito. La primera cambia la edad
 * que ya quedó impresa en cada receta emitida —que es un snapshot congelado,
 * no un JOIN— y la segunda tiene control de duplicados y validación de forma
 * propios. Corregir cualquiera de esas dos es otro caso de uso, con sus reglas.
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
}
