/**
 * Subida directa de un archivo al almacenamiento, con la política prefirmada
 * que emitió el API. Vive aquí, y no dentro de cada componente, porque el
 * flujo es idéntico para radiografías y para el logo de la clínica — y porque
 * distinguir POR QUÉ falló exige más cuidado del que cabe en un `catch`
 * suelto: un error de red y un 403 del bucket se veían igual en pantalla
 * ("No se pudo subir…"), que es justo lo que dejó a ciegas el incidente de
 * producción de agosto 2026.
 */
export type CausaFalloSubida =
  /** El navegador nunca recibió respuesta: CORS mal configurado, DNS, o sin conexión. */
  | 'red'
  /** El storage respondió, pero rechazó la subida (política vencida, firma, bucket). */
  | 'storage';

export class ErrorSubidaDirecta extends Error {
  constructor(
    readonly causa: CausaFalloSubida,
    /** Mensaje para el usuario: dice qué hacer, no qué pasó por dentro. */
    message: string,
    /** Detalle técnico (status + cuerpo del storage) para la consola y el soporte. */
    readonly detalle: string,
  ) {
    super(message);
  }
}

/**
 * Sube con un PUT prefirmado: el archivo va como body crudo y las cabeceras
 * son EXACTAMENTE las que firmó el servidor (el Content-Type forma parte de
 * la firma). No es un formulario multipart: el presigned POST de S3 no existe
 * en R2, y una subida armada así falla contra R2 haga lo que haga el bucket.
 */
export async function subirArchivoDirecto(
  uploadUrl: string,
  headers: Record<string, string>,
  file: File,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(uploadUrl, { method: 'PUT', headers, body: file });
  } catch (e) {
    // fetch solo lanza por fallo de RED. La causa habitual es que el bucket
    // no permite el origen de la app o el método PUT (CORS): el PUT lleva
    // Content-Type propio, así que el navegador manda un preflight OPTIONS
    // primero, y si el bucket no lo aprueba la petición nunca sale.
    throw new ErrorSubidaDirecta(
      'red',
      'No se pudo contactar al almacenamiento de imágenes. Avisa a soporte: es un problema de configuración, no de tu archivo.',
      `fetch a ${origenDe(uploadUrl)} falló: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!res.ok) {
    // El storage responde el detalle en XML; es lo único que distingue una
    // firma vencida de un bucket inexistente.
    const cuerpo = await res.text().catch(() => '');
    throw new ErrorSubidaDirecta(
      'storage',
      res.status === 403
        ? 'El almacenamiento rechazó la subida. Vuelve a intentar; si sigue fallando, avisa a soporte.'
        : 'El almacenamiento no aceptó la imagen. Avisa a soporte.',
      `${res.status} ${res.statusText} — ${cuerpo.slice(0, 500)}`,
    );
  }
}

function origenDe(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}
