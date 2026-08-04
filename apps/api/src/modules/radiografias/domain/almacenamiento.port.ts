/** Campos que el cliente debe mandar junto al archivo en el POST multipart. */
export interface PoliticaSubida {
  url: string;
  fields: Record<string, string>;
}

/**
 * Puerto de almacenamiento de archivos. Cualquier campo aquí debe tener
 * sentido para CUALQUIER proveedor S3-compatible (R2, S3, MinIO...), no solo
 * el actual — mismo criterio que FacturacionPacPort.
 */
export interface AlmacenamientoPort {
  /**
   * Política de subida directa (presigned POST): el navegador sube el
   * archivo DIRECTO al storage con esta política, sin pasar por el API — el
   * body JSON del API está limitado a 256kb a propósito (anti-DoS).
   */
  presignedUploadPolicy(key: string, mimeType: string): Promise<PoliticaSubida>;

  /** URL de lectura de vida corta. El bucket nunca es público. */
  presignedGetUrl(key: string): Promise<string>;

  eliminar(key: string): Promise<void>;
}

export const ALMACENAMIENTO_PORT = Symbol('ALMACENAMIENTO_PORT');
