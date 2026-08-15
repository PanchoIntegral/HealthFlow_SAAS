import { IsObject } from 'class-validator';
import type { OrdenPlantillasContent } from '@healthflow/shared-types';

/**
 * El contenido llega como objeto; no se valida campo por campo porque el
 * catálogo de casillas vive en shared-types y puede crecer sin tocar la API.
 * Mismo criterio que NoteContentDto.
 */
export class OrdenPlantillasContentDto {
  @IsObject()
  contenido!: OrdenPlantillasContent;
}
