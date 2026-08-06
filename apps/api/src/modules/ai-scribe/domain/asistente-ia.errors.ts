import { DomainError } from '../../../common/errors/domain.error';

/**
 * El proveedor de IA no respondió: timeout, red caída o 5xx tras los
 * reintentos.
 *
 * 502 y no 4xx a propósito: el médico no hizo nada mal, falló un servicio de
 * terceros. La distinción importa porque decide qué le dice la interfaz —
 * "reintenta" y no "corrige tus datos".
 */
export class AsistenteIaNoDisponibleError extends DomainError {
  readonly code = 'AsistenteIaNoDisponible';
  readonly httpStatus = 502;

  constructor() {
    super('El asistente de IA no está disponible en este momento. Intenta de nuevo.');
  }
}

/** El modelo respondió algo que no es el JSON acordado. */
export class AsistenteIaRespuestaInvalidaError extends DomainError {
  readonly code = 'AsistenteIaRespuestaInvalida';
  readonly httpStatus = 502;

  constructor() {
    super('El asistente de IA no pudo procesar el audio. Intenta de nuevo o captura la nota a mano.');
  }
}

/**
 * La clínica no tiene activado el asistente. El frontend ya oculta el botón;
 * esto es la segunda cerradura, para que activar la función nunca dependa de
 * que el cliente no sepa armar un `curl`.
 */
export class AsistenteIaNoActivadoError extends DomainError {
  readonly code = 'AsistenteIaNoActivado';
  readonly httpStatus = 403;

  constructor() {
    super('El asistente de IA no está activado para esta clínica.');
  }
}
