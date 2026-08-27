import { IsString, MaxLength, MinLength } from 'class-validator';
import { CORRECCION_TEXTO_MAX, CORRECCION_TEXTO_MIN } from '@healthflow/shared-types';

export class CrearCorreccionDto {
  /**
   * Qué se rectifica y por qué. El mínimo obliga a explicar: una adenda que
   * dice "error" no le sirve a nadie que lea el expediente después, y es
   * justamente lo que un perito va a leer.
   */
  @IsString()
  @MinLength(CORRECCION_TEXTO_MIN)
  @MaxLength(CORRECCION_TEXTO_MAX)
  texto!: string;
}
