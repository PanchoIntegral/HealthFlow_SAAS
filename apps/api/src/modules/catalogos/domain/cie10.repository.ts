import type { DiagnosticoCie10 } from '@healthflow/shared-types';

/**
 * Puerto (interface) del catálogo CIE-10. A diferencia de los demás repos de
 * la app, NO recibe `Tx` con tenant fijado: es una tabla de referencia global
 * (sin tenant_id/RLS — ver 0008_cie10.sql), así que una consulta directa
 * sobre la conexión de aplicación basta.
 */
export interface Cie10Repository {
  buscar(query: string, limit?: number): Promise<DiagnosticoCie10[]>;
}

export const CIE10_REPOSITORY = Symbol('CIE10_REPOSITORY');
