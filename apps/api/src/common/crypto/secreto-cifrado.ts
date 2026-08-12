import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Cifrado simétrico de secretos que se guardan en la base (hoy: el access token
 * de WhatsApp de las clínicas con número propio).
 *
 * Dos decisiones que no son obvias:
 *
 * 1. **AAD = tenantId.** El dato asociado autenticado ata el ciphertext a la
 *    clínica dueña. Copiar la fila cifrada a otro tenant —por un bug, por un
 *    restore mal hecho o por alguien con acceso a la base— produce un error de
 *    autenticación en vez de entregar el token. El cifrado no depende solo de
 *    que la llave esté a salvo.
 *
 * 2. **Formato versionado con id de llave**, `v1.<keyId>.<iv>.<tag>.<ct>`. Rotar
 *    la llave es añadir una entrada al llavero y cambiar cuál es la activa: lo
 *    viejo se sigue descifrando con su propia llave y lo nuevo se cifra con la
 *    nueva, sin migración de datos ni ventana de indisponibilidad.
 *
 * AES-256-GCM: cifra y autentica en una sola pasada, así que un ciphertext
 * manipulado falla al descifrar en vez de devolver basura.
 */

const VERSION = 'v1';
const IV_BYTES = 12; // recomendado para GCM: 96 bits
const TAG_BYTES = 16;
const LLAVE_BYTES = 32; // AES-256

export interface Keyring {
  /** Id de la llave con la que se cifra lo nuevo. */
  readonly activa: string;
  /** Todas las llaves conocidas, incluida la activa: se descifra con la del prefijo. */
  readonly llaves: ReadonlyMap<string, Buffer>;
}

export class SecretoCifradoError extends Error {}

/**
 * Construye el llavero desde su forma serializada en env:
 * `{"k1":"<32 bytes en base64>","k2":"..."}` más el id de la activa.
 */
export function cargarKeyring(llavesJson: string, activa: string): Keyring {
  let crudo: unknown;
  try {
    crudo = JSON.parse(llavesJson);
  } catch {
    throw new SecretoCifradoError('El llavero de cifrado no es un JSON válido');
  }
  if (typeof crudo !== 'object' || crudo === null || Array.isArray(crudo)) {
    throw new SecretoCifradoError('El llavero de cifrado debe ser un objeto {keyId: llaveBase64}');
  }

  const llaves = new Map<string, Buffer>();
  for (const [keyId, valor] of Object.entries(crudo as Record<string, unknown>)) {
    // El keyId viaja en el prefijo del ciphertext; restringirlo evita que un
    // separador dentro del id rompa el parseo al descifrar.
    if (!/^[A-Za-z0-9_-]+$/.test(keyId)) {
      throw new SecretoCifradoError(`Id de llave inválido: ${keyId}`);
    }
    if (typeof valor !== 'string') {
      throw new SecretoCifradoError(`La llave ${keyId} debe ser una cadena base64`);
    }
    const bytes = Buffer.from(valor, 'base64');
    if (bytes.length !== LLAVE_BYTES) {
      throw new SecretoCifradoError(
        `La llave ${keyId} debe ser de ${LLAVE_BYTES} bytes (AES-256), no de ${bytes.length}`,
      );
    }
    llaves.set(keyId, bytes);
  }

  if (!llaves.has(activa)) {
    throw new SecretoCifradoError(`La llave activa "${activa}" no está en el llavero`);
  }
  return { activa, llaves };
}

/** Genera una llave nueva lista para pegar en el llavero. Útil en scripts de setup. */
export function generarLlaveBase64(): string {
  return randomBytes(LLAVE_BYTES).toString('base64');
}

export function cifrarSecreto(plano: string, aad: string, keyring: Keyring): string {
  const llave = keyring.llaves.get(keyring.activa);
  if (!llave) throw new SecretoCifradoError('El llavero no contiene la llave activa');

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', llave, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plano, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, keyring.activa, b64u(iv), b64u(tag), b64u(ct)].join('.');
}

export function descifrarSecreto(cifrado: string, aad: string, keyring: Keyring): string {
  const partes = cifrado.split('.');
  if (partes.length !== 5 || partes.some((p) => p === undefined || p === '')) {
    throw new SecretoCifradoError('Formato de secreto cifrado inválido');
  }
  const [version, keyId, ivB64, tagB64, ctB64] = partes as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (version !== VERSION) {
    throw new SecretoCifradoError(`Versión de cifrado desconocida: ${version}`);
  }

  const llave = keyring.llaves.get(keyId);
  // Mensaje deliberadamente escueto: no revela qué llaves existen.
  if (!llave) throw new SecretoCifradoError('No hay llave para descifrar este secreto');

  const iv = unb64u(ivB64);
  const tag = unb64u(tagB64);
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretoCifradoError('Formato de secreto cifrado inválido');
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', llave, iv);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(unb64u(ctB64)), decipher.final()]).toString('utf8');
  } catch {
    // Un AAD que no corresponde, un tag alterado o una llave equivocada caen
    // todos aquí, y a propósito son indistinguibles desde fuera.
    throw new SecretoCifradoError('No se pudo descifrar el secreto');
  }
}

/**
 * Comparación en tiempo constante para secretos de longitud variable.
 * `timingSafeEqual` de Node LANZA si los buffers difieren en longitud, así que
 * hay que medir primero — y esa comparación de longitud sí filtra el tamaño,
 * que para un token de configuración no es información sensible.
 */
export function igualSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function b64u(b: Buffer): string {
  return b.toString('base64url');
}

function unb64u(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}
