import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../../../config/env';
import type {
  CredencialesWhatsapp,
  ErrorEnvio,
  MensajePlantilla,
  ResultadoEnvio,
  WhatsappSender,
} from '../../application/whatsapp-sender.port';

/** Meta no responde en más de unos segundos; pasado esto la fila se reintenta. */
const TIMEOUT_MS = 10_000;

/**
 * Códigos de error de Meta que NO tiene sentido reintentar: reintentarlos solo
 * gasta cuota y retrasa los mensajes que sí pueden salir.
 *
 *   131026 — el número no puede recibir mensajes (no tiene WhatsApp).
 *   131047 — fuera de la ventana de 24 h para mensajes de forma libre.
 *   131051 — tipo de mensaje no soportado.
 *   132000/132001/132005/132007/132012/132015 — la plantilla no existe, no está
 *     aprobada, está pausada o no cuadra con los parámetros enviados.
 *   190    — el access token expiró o fue revocado: hasta que alguien lo
 *            cambie en Ajustes, reintentar no lo va a arreglar.
 */
const DEFINITIVOS = new Set([
  '131026',
  '131047',
  '131051',
  '132000',
  '132001',
  '132005',
  '132007',
  '132012',
  '132015',
  '190',
]);

interface RespuestaMeta {
  messages?: { id: string }[];
  error?: { code?: number; error_subcode?: number; message?: string; type?: string };
}

/**
 * Adaptador real contra la Cloud API de Meta.
 *
 * Sin reintentos propios a propósito: el reintento vive en el outbox, con su
 * backoff y su tope, y así sobrevive a un reinicio del proceso. Un reintento
 * aquí dentro además mantendría la fila en 'enviando' mucho más tiempo.
 */
@Injectable()
export class CloudApiWhatsappAdapter implements WhatsappSender {
  private readonly logger = new Logger('WhatsApp(cloud)');

  async enviarPlantilla(
    credenciales: CredencialesWhatsapp,
    mensaje: MensajePlantilla,
  ): Promise<ResultadoEnvio> {
    const url = `https://graph.facebook.com/${env.whatsappGraphVersion}/${credenciales.phoneNumberId}/messages`;

    let respuesta: Response;
    try {
      respuesta = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credenciales.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(cuerpo(mensaje)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // Timeout o red caída: siempre reintentable, y nunca se filtra la URL
      // (que lleva el phone_number_id) al mensaje que se persiste.
      return {
        ok: false,
        error: {
          codigo: 'red',
          mensaje: sanear(error instanceof Error ? error.message : String(error), credenciales),
          reintentable: true,
        },
      };
    }

    let json: RespuestaMeta;
    try {
      json = (await respuesta.json()) as RespuestaMeta;
    } catch {
      json = {};
    }

    const metaMessageId = json.messages?.[0]?.id;
    if (respuesta.ok && metaMessageId) {
      return { ok: true, metaMessageId };
    }

    return { ok: false, error: this.interpretar(respuesta, json, credenciales) };
  }

  private interpretar(
    respuesta: Response,
    json: RespuestaMeta,
    credenciales: CredencialesWhatsapp,
  ): ErrorEnvio {
    const codigo = json.error?.code !== undefined ? String(json.error.code) : String(respuesta.status);
    const texto = sanear(json.error?.message ?? `HTTP ${respuesta.status}`, credenciales);

    // 429 y 5xx son del lado de Meta y pasan solos; el resto se juzga por el
    // código de aplicación. Ante un código desconocido se reintenta: es
    // preferible gastar un intento de más a descartar un aviso por un error
    // transitorio que aún no está en la lista.
    const reintentable =
      respuesta.status === 429 || respuesta.status >= 500 ? true : !DEFINITIVOS.has(codigo);

    if (!reintentable) {
      this.logger.warn(`Envío descartado sin reintento (${codigo}): ${texto}`);
    }
    return { codigo, mensaje: texto, reintentable };
  }
}

function cuerpo(mensaje: MensajePlantilla): Record<string, unknown> {
  return {
    messaging_product: 'whatsapp',
    // El `+` inicial de E.164 lo acepta Meta; se manda tal cual para que lo
    // que viaja sea exactamente lo que la clínica ve en la ficha.
    to: mensaje.aE164,
    type: 'template',
    template: {
      name: mensaje.plantilla,
      language: { code: mensaje.idioma },
      components: [
        {
          type: 'body',
          parameters: mensaje.variables.map((text) => ({ type: 'text', text })),
        },
      ],
    },
  };
}

/**
 * Quita del texto cualquier rastro del access token antes de persistirlo.
 *
 * Meta a veces devuelve en el mensaje de error la URL completa de la petición,
 * y algunos flujos la llevan con parámetros. `ultimo_error` se guarda en la
 * base y se muestra en Ajustes: un token filtrado ahí es un token comprometido.
 */
export function sanear(texto: string, credenciales: CredencialesWhatsapp): string {
  return texto.split(credenciales.accessToken).join('***').slice(0, 500);
}
