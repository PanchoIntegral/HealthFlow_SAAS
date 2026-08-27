/**
 * Instrucciones para que el navegador suba el archivo DIRECTO al storage.
 *
 * Es una URL prefirmada de PUT, no un formulario multipart (presigned POST):
 * el presigned POST de S3 NO existe en R2 —su API S3-compatible no implementa
 * PostObject— y una subida armada así falla siempre contra R2 aunque el
 * bucket, las credenciales y el CORS estén perfectos. PutObject sí está
 * implementado, y además es el denominador común de todo proveedor
 * S3-compatible (S3, R2, MinIO), que es el criterio de este puerto.
 */
export interface SubidaDirecta {
  url: string;
  /** Cabeceras que el cliente DEBE mandar tal cual: van dentro de la firma. */
  headers: Record<string, string>;
}

/** Metadata real del objeto en storage, según el storage y no según el cliente. */
export interface ObjetoAlmacenado {
  existe: boolean;
  tamanoBytes?: number;
  mimeType?: string;
}

/**
 * Reporte de estado del proveedor, para diagnosticar desde producción sin
 * abrir la consola del proveedor. `ok:false` no distingue el motivo: eso va
 * en `detalles`, que cada adaptador llena con lo suyo (bucket, CORS...).
 */
export interface DiagnosticoStorage {
  ok: boolean;
  detalles: Record<string, unknown>;
}

/**
 * Puerto de almacenamiento de archivos. Cualquier campo aquí debe tener
 * sentido para CUALQUIER proveedor S3-compatible (R2, S3, MinIO...), no solo
 * el actual — mismo criterio que FacturacionPacPort.
 */
export interface AlmacenamientoPort {
  /**
   * URL de subida directa de vida corta: el navegador sube el archivo con un
   * PUT a esta URL, sin pasar por el API — el body JSON del API está limitado
   * a 256kb a propósito (anti-DoS).
   */
  presignedUploadUrl(key: string, mimeType: string): Promise<SubidaDirecta>;

  /** URL de lectura de vida corta. El bucket nunca es público. */
  presignedGetUrl(key: string): Promise<string>;

  /**
   * Qué hay REALMENTE en esa clave. La usa el paso de confirmación: sin esto,
   * el API registraría metadata fiándose de que el navegador subió lo que
   * dijo, y una subida a medias dejaría una radiografía que no se puede abrir.
   */
  verificarObjeto(key: string): Promise<ObjetoAlmacenado>;

  eliminar(key: string): Promise<void>;

  /**
   * Estado del proveedor (credenciales, bucket, CORS). Opcional: un adaptador
   * de dev no tiene nada que reportar. NUNCA debe devolver secretos.
   */
  diagnostico?(): Promise<DiagnosticoStorage>;
}

export const ALMACENAMIENTO_PORT = Symbol('ALMACENAMIENTO_PORT');
