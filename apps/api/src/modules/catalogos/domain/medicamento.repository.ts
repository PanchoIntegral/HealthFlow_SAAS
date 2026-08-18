import type { MedicamentoCatalogo } from '@healthflow/shared-types';

/**
 * Puerto del catálogo de medicamentos. Igual que `Cie10Repository`, NO recibe
 * `Tx` con tenant fijado: `medicamentos` es una tabla de referencia global sin
 * tenant_id ni RLS (ver 0027_medicamentos.sql).
 */
export interface MedicamentoRepository {
  buscar(query: string, limit?: number): Promise<MedicamentoCatalogo[]>;
}

export const MEDICAMENTO_REPOSITORY = Symbol('MEDICAMENTO_REPOSITORY');
