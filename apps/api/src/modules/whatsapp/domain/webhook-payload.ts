import type { WhatsappEstadoOutbox } from '@healthflow/shared-types';

/**
 * Interpretación del payload que manda Meta.
 *
 * Puro y sin dependencias a propósito: es la frontera con un tercero cuyo
 * formato no controlamos y que además llega por un endpoint público. Todo lo
 * que entra aquí es `unknown` hasta que se demuestre lo contrario; un payload
 * raro debe producir "no entendí" y nunca una excepción que tumbe el handler.
 */

/** Acciones que el paciente puede disparar desde los botones del recordatorio. */
export const ACCIONES_BOTON = ['confirmar', 'cancelar', 'reagendar'] as const;
export type AccionBoton = (typeof ACCIONES_BOTON)[number];

export interface EventoEstado {
  tipo: 'estado';
  /** Id del mensaje saliente al que se refiere: la llave de ruteo. */
  metaMessageId: string;
  estado: WhatsappEstadoOutbox;
  error: string | null;
}

export interface EventoBoton {
  tipo: 'boton';
  /**
   * Id del mensaje al que responde el paciente (`context.id`). ÚNICA forma
   * admitida de saber de qué clínica y de qué cita se trata: resolver por el
   * teléfono del remitente sería una fuga entre tenants, porque el mismo
   * celular puede ser paciente en dos clínicas.
   */
  contextMessageId: string;
  accion: AccionBoton;
}

export interface EventoBaja {
  tipo: 'baja';
  /** Referencia al mensaje previo, si el paciente respondió a uno. */
  contextMessageId: string | null;
  /** Teléfono del remitente. Solo utilizable DENTRO del tenant ya resuelto. */
  deE164: string;
}

export type EventoWhatsapp = EventoEstado | EventoBoton | EventoBaja;

/** Palabras con las que un paciente pide que dejen de escribirle. */
const PALABRAS_BAJA = new Set(['baja', 'stop', 'alto', 'cancelar suscripcion', 'no molestar']);

const ESTADOS_META: Record<string, WhatsappEstadoOutbox> = {
  sent: 'enviado',
  delivered: 'entregado',
  read: 'leido',
  failed: 'fallido',
};

/**
 * Extrae los eventos que nos importan. Lo que no se reconoce se ignora en
 * silencio: Meta añade tipos de evento con el tiempo y un payload desconocido
 * no es un error.
 */
export function parsearWebhook(payload: unknown): EventoWhatsapp[] {
  const eventos: EventoWhatsapp[] = [];

  for (const entry of arreglo(prop(payload, 'entry'))) {
    for (const change of arreglo(prop(entry, 'changes'))) {
      const value = prop(change, 'value');

      for (const status of arreglo(prop(value, 'statuses'))) {
        const evento = parsearEstado(status);
        if (evento) eventos.push(evento);
      }

      for (const message of arreglo(prop(value, 'messages'))) {
        const evento = parsearMensaje(message);
        if (evento) eventos.push(evento);
      }
    }
  }
  return eventos;
}

function parsearEstado(status: unknown): EventoEstado | null {
  const metaMessageId = texto(prop(status, 'id'));
  const estado = ESTADOS_META[texto(prop(status, 'status')) ?? ''];
  if (!metaMessageId || !estado) return null;

  const errores = arreglo(prop(status, 'errors'));
  const primero = errores[0];
  const error = primero
    ? `${texto(prop(primero, 'code')) ?? '?'}: ${texto(prop(primero, 'title')) ?? 'sin detalle'}`
    : null;

  return { tipo: 'estado', metaMessageId, estado, error };
}

function parsearMensaje(message: unknown): EventoBoton | EventoBaja | null {
  const contextMessageId = texto(prop(prop(message, 'context'), 'id'));
  const deE164 = normalizarRemitente(texto(prop(message, 'from')));

  // La baja se evalúa ANTES que cualquier otra rama: si alguien escribe "BAJA"
  // hay que dejar de escribirle, aunque el mensaje traiga además otra cosa.
  const cuerpo = texto(prop(prop(message, 'text'), 'body'));
  if (cuerpo && esBaja(cuerpo) && deE164) {
    return { tipo: 'baja', contextMessageId: contextMessageId ?? null, deE164 };
  }

  const tipo = texto(prop(message, 'type'));
  if (tipo !== 'button' && tipo !== 'interactive') return null;

  // Dos formas según cómo se declaró el botón en la plantilla: las de respuesta
  // rápida de una plantilla llegan como `button.payload`; las de un mensaje
  // interactivo, como `interactive.button_reply.id`.
  const payload =
    texto(prop(prop(message, 'button'), 'payload')) ??
    texto(prop(prop(prop(message, 'interactive'), 'button_reply'), 'id')) ??
    texto(prop(prop(message, 'button'), 'text'));

  const accion = normalizarAccion(payload);
  if (!accion || !contextMessageId) return null;

  return { tipo: 'boton', contextMessageId, accion };
}

/** Un botón puede llegar como `confirmar` o como `confirmar:<algo>`. */
export function normalizarAccion(payload: string | null): AccionBoton | null {
  if (!payload) return null;
  const base = sinAcentos(payload.split(':')[0] ?? '').trim().toLowerCase();
  return (ACCIONES_BOTON as readonly string[]).includes(base) ? (base as AccionBoton) : null;
}

export function esBaja(cuerpo: string): boolean {
  return PALABRAS_BAJA.has(sinAcentos(cuerpo).trim().toLowerCase().replace(/[.!¡]/g, ''));
}

/**
 * Meta manda el teléfono sin `+`. Se le antepone para poder compararlo con lo
 * que guardamos en E.164.
 */
export function normalizarRemitente(from: string | null): string | null {
  if (!from) return null;
  const digitos = from.replace(/\D/g, '');
  return digitos ? `+${digitos}` : null;
}

function sinAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ── Acceso defensivo a un objeto de forma desconocida ────────────

function prop(valor: unknown, clave: string): unknown {
  if (typeof valor !== 'object' || valor === null) return undefined;
  return (valor as Record<string, unknown>)[clave];
}

function arreglo(valor: unknown): unknown[] {
  return Array.isArray(valor) ? valor : [];
}

function texto(valor: unknown): string | null {
  if (typeof valor === 'string' && valor.length > 0) return valor;
  if (typeof valor === 'number') return String(valor);
  return null;
}
