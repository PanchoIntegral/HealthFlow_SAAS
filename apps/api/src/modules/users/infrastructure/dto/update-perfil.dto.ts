import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ESPECIALIDADES, type EspecialidadKey } from '@healthflow/shared-types';

export class UpdatePerfilDto {
  @IsIn(ESPECIALIDADES)
  especialidadKey!: EspecialidadKey;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  especialidad?: string;

  /**
   * Cédula profesional. Se valida la FORMA, no la existencia: el registro real
   * vive en el Registro Nacional de Profesionistas de la SEP, y verificar
   * contra ese servicio es otro trabajo. Aquí solo se atrapa el dedazo.
   *
   * Se aceptan letras además de dígitos a propósito: junto a las cédulas
   * numéricas de 7-8 dígitos hay claves de especialidad y de profesionistas
   * extranjeros que no son puramente numéricas, y rechazarlas dejaría a esos
   * médicos sin poder firmar. La cadena vacía se permite: es como se borra una
   * cédula mal capturada.
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9-]*$/, {
    message: 'La cédula profesional solo puede tener letras, números y guiones',
  })
  cedulaProfesional?: string;
}
