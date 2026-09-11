import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../errors/domain.error';

/**
 * Tokens de los enlaces públicos: plan de tratamiento, formularios, portal del
 * paciente y pagos (§5.6).
 *
 * Reglas que este módulo hace cumplir, en un solo lugar para que ningún módulo
 * futuro invente las suyas:
 *
 *  - 256 bits de aleatoriedad de CSPRNG (32 bytes, base64url → 43 caracteres);
 *  - en PostgreSQL vive SOLO el SHA-256; el token claro existe únicamente en
 *    el enlace que recibe el paciente y nunca se registra en bitácora ni logs;
 *  - todo token declara PROPÓSITO, VIGENCIA, REVOCACIÓN y LÍMITE DE USOS;
 *  - cualquier rechazo produce la MISMA respuesta hacia afuera, para que nadie
 *    distinga "no existe" de "venció" y pueda enumerar pacientes o documentos.
 *
 * El motivo real del rechazo sí se devuelve al llamador —para métricas y para
 * decidir un reintento— pero jamás viaja al cliente.
 */

/** Longitud en bytes: 32 = 256 bits, el mínimo que exige §5.6. */
const BYTES = 32;
/** base64url de 32 bytes son 43 caracteres; el rango tolera tokens heredados. */
const FORMATO = /^[A-Za-z0-9_-]{40,60}$/;

export function generarTokenPublico(): string {
  return randomBytes(BYTES).toString('base64url');
}

export function hashTokenPublico(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Descarta basura ANTES de tocar la base: un token mal formado no se consulta. */
export function esFormatoDeTokenPublico(token: string): boolean {
  return FORMATO.test(token);
}

/** Compara dos hashes en tiempo constante. */
export function hashesIguales(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

export type PropositoToken =
  | 'plan_tratamiento'
  | 'formulario'
  | 'portal_paciente'
  | 'pago'
  | 'gestion_cita';

/** El estado del token tal como está guardado. */
export interface EstadoTokenPublico {
  proposito: PropositoToken;
  expiresAt: Date | null;
  revokedAt: Date | null;
  usos: number;
  /** `null` = sin límite de usos (un enlace de consulta, no de acción). */
  maxUsos: number | null;
}

export type MotivoRechazo =
  | 'formato'
  | 'inexistente'
  | 'vencido'
  | 'revocado'
  | 'agotado'
  | 'proposito';

export type ResultadoToken = { ok: true } | { ok: false; motivo: MotivoRechazo };

/**
 * Decide si un token puede usarse. Puro: recibe el reloj, no lo consulta.
 *
 * El orden de las comprobaciones no importa para el cliente (la respuesta es
 * la misma), pero sí para las métricas: revocado antes que vencido, porque un
 * enlace revocado es una señal operativa y uno vencido es rutina.
 */
export function evaluarToken(
  estado: EstadoTokenPublico,
  propositoEsperado: PropositoToken,
  ahora: Date,
): ResultadoToken {
  if (estado.proposito !== propositoEsperado) return { ok: false, motivo: 'proposito' };
  if (estado.revokedAt && estado.revokedAt.getTime() <= ahora.getTime()) {
    return { ok: false, motivo: 'revocado' };
  }
  if (estado.expiresAt && estado.expiresAt.getTime() <= ahora.getTime()) {
    return { ok: false, motivo: 'vencido' };
  }
  if (estado.maxUsos !== null && estado.usos >= estado.maxUsos) {
    return { ok: false, motivo: 'agotado' };
  }
  return { ok: true };
}

/**
 * Único error que ven los enlaces públicos. Mismo `code`, mismo mensaje y
 * mismo status para las seis causas: es lo que impide enumerar (§5.6).
 * El motivo queda del lado del servidor, para métricas.
 */
export class EnlaceNoValidoError extends DomainError {
  readonly code = 'EnlaceNoValido';
  readonly httpStatus = 404;

  constructor(readonly motivo: MotivoRechazo) {
    super('Este enlace ya no es válido. Pídele uno nuevo a tu clínica.');
  }

  /** A propósito vacío: el motivo NO viaja al cliente. */
  details(): Record<string, unknown> {
    return {};
  }
}
