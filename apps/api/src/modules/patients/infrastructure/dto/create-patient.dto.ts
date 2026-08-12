import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreatePatientDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  nombre!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fechaNacimiento debe ser YYYY-MM-DD' })
  fechaNacimiento!: string;

  @IsOptional()
  @IsString()
  @MaxLength(18)
  curp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  telefono?: string;

  /**
   * Consentimiento para recibir recordatorios por WhatsApp. Debe venir de una
   * casilla que el paciente marca, no de un default.
   *
   * Aquí NO se recibe el número en E.164: lo deriva la entidad a partir de
   * `telefono`, para que el número al que se manda el mensaje no pueda diferir
   * del que la clínica ve en la ficha.
   */
  @IsOptional()
  @IsBoolean()
  whatsappOptIn?: boolean;
}
