import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { NOTAS_PAGE_SIZE_MAX } from '@healthflow/shared-types';

/**
 * Paginación del historial en GET /patients/:id/clinical-record.
 *
 * Ambos parámetros son opcionales: sin ellos se devuelve la primera página
 * con el tamaño por omisión, que es lo que necesita la vista del expediente.
 */
export class ClinicalRecordQueryDto {
  /** Cuántas notas devolver. Acotado para que nadie pida el expediente entero. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTAS_PAGE_SIZE_MAX)
  limit?: number;

  /** Cursor opaco devuelto como `nextCursor` en la página anterior. */
  @IsOptional()
  @IsString()
  cursor?: string;
}
