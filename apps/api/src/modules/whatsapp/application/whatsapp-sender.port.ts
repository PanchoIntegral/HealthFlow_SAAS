import type { WhatsappPlantilla } from '@healthflow/shared-types';

export const WHATSAPP_SENDER = Symbol('WHATSAPP_SENDER');

/** Credenciales ya resueltas: el puerto no sabe de modo compartido ni cifrado. */
export interface CredencialesWhatsapp {
  phoneNumberId: string;
  /** En claro. Quien implemente esto NUNCA debe loguearlo. */
  accessToken: string;
}

export interface MensajePlantilla {
  aE164: string;
  plantilla: WhatsappPlantilla;
  idioma: string; // 'es_MX'
  /**
   * Variables del cuerpo, en orden. NUNCA información clínica: el nombre del
   * paciente, la fecha, la hora y el médico sí; el motivo de la consulta no.
   */
  variables: string[];
  /** Payloads de los botones de respuesta rápida, en el orden de la plantilla. */
  botones?: readonly string[];
}

export interface ErrorEnvio {
  codigo: string;
  /** Ya saneado: sin tokens ni URLs con credenciales. Se persiste tal cual. */
  mensaje: string;
  /**
   * ¿Vale la pena reintentar? Un 5xx o un 429 sí; un número inválido o una
   * plantilla no aprobada no, y reintentarlos solo gasta cuota.
   */
  reintentable: boolean;
}

export type ResultadoEnvio =
  | { ok: true; metaMessageId: string }
  | { ok: false; error: ErrorEnvio };

/**
 * Salida de mensajes de WhatsApp.
 *
 * Devuelve el resultado en vez de lanzar: el fallo de un envío es un dato de
 * negocio que se guarda en el outbox y se reintenta con criterio, no una
 * excepción que aborte el barrido de las demás clínicas.
 *
 * El puerto está pensado para que otro canal (email para recibos y CFDI) se
 * enchufe igual: nada de su forma es específico de Meta salvo `metaMessageId`,
 * que es simplemente el identificador que devuelve el proveedor.
 */
export interface WhatsappSender {
  enviarPlantilla(
    credenciales: CredencialesWhatsapp,
    mensaje: MensajePlantilla,
  ): Promise<ResultadoEnvio>;
}
