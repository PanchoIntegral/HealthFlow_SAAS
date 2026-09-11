/**
 * Clasificación de datos para bitácora y eventos internos (§5.3, §14, §17.5).
 *
 * DOS niveles, porque los dos destinos tienen reglas distintas:
 *
 *  - `asegurarDetalleAuditable` — la bitácora de auditoría SÍ puede (y debe)
 *    identificar sobre qué se actuó: nombre del paciente, CURP, folio, motivo.
 *    Lo que nunca puede llevar son CREDENCIALES (tokens, contraseñas, firmas),
 *    destinos de contacto o cuerpos completos (la nota clínica, el payload
 *    crudo del PAC o del proveedor de mensajería).
 *
 *  - `asegurarPayloadDeEvento` — un evento interno solo transporta
 *    IDENTIFICADORES y ESTADO para que otro módulo vaya a buscar el dato a su
 *    dueño. Ahí no hay razón legítima para un nombre ni para texto libre.
 *
 * Módulo PURO: sin Nest, sin base de datos, sin reloj. Se prueba solo.
 */

/** Claves que jamás deben persistirse, ni en auditoría ni en eventos. */
const CLAVES_PROHIBIDAS_SIEMPRE = new Set([
  'password',
  'contrasena',
  'passwordhash',
  'token',
  'tokenhash',
  'secret',
  'secreto',
  'apikey',
  'authorization',
  'signature',
  'firma',
  'firmapng',
  'rawpayload',
  'rawbody',
  'providerpayload',
  'webhookpayload',
]);

/** Además de las anteriores: prohibidas en un evento interno. */
const CLAVES_PROHIBIDAS_EN_EVENTOS = new Set([
  'nombre',
  'nombrepaciente',
  'apellidos',
  'email',
  'correo',
  'telefono',
  'celular',
  'phone',
  'direccion',
  'curp',
  'rfc',
  'nota',
  'notas',
  'diagnostico',
  'padecimiento',
  'alergias',
  'medicamentos',
  'mediciones',
  'observaciones',
]);

/** Cuerpo clínico o payload de proveedor disfrazado de "campo de texto". */
const MAX_TEXTO_AUDITORIA = 2000;
/** Un evento no transporta prosa: ni un motivo largo, ni una nota. */
const MAX_TEXTO_EVENTO = 120;
const MAX_PROFUNDIDAD_EVENTO = 3;
/** Igual que el CHECK de `app_events.payload` en la migración 0046. */
const MAX_BYTES_EVENTO = 4096;

const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
// Sin punto en la clase: así un importe "12345678.90" no se confunde con un
// teléfono. Las fechas ISO se descartan aparte (empiezan por AAAA-MM-DD).
const TELEFONO_E164 = /^\+?\d[\d\s()-]{8,18}$/;
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}/;
/** JWT o token opaco largo en base64url/hex. */
const CREDENCIAL = /^(?:[\w-]+\.[\w-]+\.[\w-]+|[A-Za-z0-9_-]{40,}|[0-9a-f]{40,})$/;

export class DatoSensibleError extends Error {
  constructor(
    readonly ruta: string,
    readonly motivo: string,
  ) {
    super(`Campo sensible en '${ruta}': ${motivo}`);
    this.name = 'DatoSensibleError';
  }
}

/** `Teléfono_Normalizado` → `telefononormalizado`, para comparar claves. */
function normalizarClave(clave: string): string {
  return clave
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

interface Reglas {
  claves: ReadonlySet<string>[];
  maxTexto: number;
  maxProfundidad: number;
  rechazarContacto: boolean;
}

function revisar(valor: unknown, reglas: Reglas, ruta: string, profundidad: number): void {
  if (profundidad > reglas.maxProfundidad) {
    throw new DatoSensibleError(ruta, `anidamiento mayor a ${reglas.maxProfundidad} niveles`);
  }
  if (valor === null || valor === undefined) return;

  if (typeof valor === 'string') {
    if (valor.length > reglas.maxTexto) {
      throw new DatoSensibleError(ruta, `texto de ${valor.length} caracteres (máximo ${reglas.maxTexto})`);
    }
    if (CREDENCIAL.test(valor)) throw new DatoSensibleError(ruta, 'parece un token o una credencial');
    if (reglas.rechazarContacto) {
      if (EMAIL.test(valor)) throw new DatoSensibleError(ruta, 'parece un correo electrónico');
      // Un identificador con guiones no es un teléfono; el UUID se descarta antes.
      const soloDigitos = valor.replace(/\D/g, '');
      if (
        !FECHA_ISO.test(valor) &&
        TELEFONO_E164.test(valor) &&
        soloDigitos.length >= 10 &&
        soloDigitos.length <= 15
      ) {
        throw new DatoSensibleError(ruta, 'parece un número telefónico');
      }
    }
    return;
  }

  if (Array.isArray(valor)) {
    valor.forEach((item, i) => revisar(item, reglas, `${ruta}[${i}]`, profundidad + 1));
    return;
  }

  if (typeof valor === 'object') {
    for (const [clave, item] of Object.entries(valor as Record<string, unknown>)) {
      const normal = normalizarClave(clave);
      for (const conjunto of reglas.claves) {
        if (conjunto.has(normal)) {
          throw new DatoSensibleError(ruta ? `${ruta}.${clave}` : clave, 'la clave está prohibida en este destino');
        }
      }
      revisar(item, reglas, ruta ? `${ruta}.${clave}` : clave, profundidad + 1);
    }
  }
}

/**
 * Valida el `detalle` de una entrada de auditoría. Lanza `DatoSensibleError`.
 *
 * Falla en vez de recortar en silencio: un detalle que trae un token es un bug
 * del caso de uso, y taparlo dejaría el bug vivo. La transacción se revierte
 * completa, así que no queda una acción de negocio sin su auditoría.
 */
export function asegurarDetalleAuditable(detalle: Record<string, unknown> | undefined): void {
  if (!detalle) return;
  revisar(
    detalle,
    {
      claves: [CLAVES_PROHIBIDAS_SIEMPRE],
      maxTexto: MAX_TEXTO_AUDITORIA,
      maxProfundidad: 6,
      rechazarContacto: true,
    },
    '',
    0,
  );
}

/** Valida el payload de un evento interno (§14). Lanza `DatoSensibleError`. */
export function asegurarPayloadDeEvento(payload: Record<string, unknown> | undefined): void {
  if (!payload) return;
  revisar(
    payload,
    {
      claves: [CLAVES_PROHIBIDAS_SIEMPRE, CLAVES_PROHIBIDAS_EN_EVENTOS],
      maxTexto: MAX_TEXTO_EVENTO,
      maxProfundidad: MAX_PROFUNDIDAD_EVENTO,
      rechazarContacto: true,
    },
    '',
    0,
  );
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (bytes > MAX_BYTES_EVENTO) {
    throw new DatoSensibleError('', `payload de ${bytes} bytes (máximo ${MAX_BYTES_EVENTO})`);
  }
}
