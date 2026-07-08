import { IsObject } from 'class-validator';
import type { NotaEvolucionContent } from '@healthflow/shared-types';

/**
 * El contenido de la nota llega como objeto; las reglas clínicas (campos
 * obligatorios NOM-004) las valida el dominio (NOM004Validator), no el DTO.
 * Aquí solo garantizamos que venga un objeto (para no perderlo con `whitelist`).
 */
export class NoteContentDto {
  @IsObject()
  contenido!: NotaEvolucionContent;
}
