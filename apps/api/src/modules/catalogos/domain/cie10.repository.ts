import type { DiagnosticoCie10, RangoCie10 } from '@healthflow/shared-types';

/**
 * Puerto (interface) del catálogo CIE-10. A diferencia de los demás repos de
 * la app, NO recibe `Tx` con tenant fijado: es una tabla de referencia global
 * (sin tenant_id/RLS — ver 0008_cie10.sql), así que una consulta directa
 * sobre la conexión de aplicación basta.
 */
export interface Cie10Repository {
  /**
   * @param rangos Rangos de código que se muestran PRIMERO. No filtran: el
   *   catálogo completo sigue siendo alcanzable, porque un dentista necesita
   *   poder codificar la diabetes que condiciona el tratamiento periodontal.
   */
  buscar(query: string, rangos?: readonly RangoCie10[], limit?: number): Promise<DiagnosticoCie10[]>;
}

export const CIE10_REPOSITORY = Symbol('CIE10_REPOSITORY');
