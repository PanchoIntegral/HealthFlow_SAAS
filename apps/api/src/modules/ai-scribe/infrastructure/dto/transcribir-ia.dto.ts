import { Transform } from 'class-transformer';
import { IsObject, IsOptional } from 'class-validator';
import type { NotaEvolucionContent } from '@healthflow/shared-types';

/**
 * Acompaña al audio en el mismo `multipart/form-data`.
 *
 * `camposYaLlenados` viaja como texto JSON porque un FormData solo lleva
 * archivos y cadenas: no hay forma de mandar un objeto anidado junto a un
 * archivo sin serializarlo. Se parsea aquí, en el borde, y si el JSON viene
 * roto se ignora en vez de tumbar la petición — es un dato de ayuda para el
 * prompt, no algo sin lo cual la transcripción no pueda ocurrir.
 */
export class TranscribirIaDto {
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  })
  @IsObject()
  camposYaLlenados?: Partial<NotaEvolucionContent>;
}
