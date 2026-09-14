import { createHmac } from 'node:crypto';
import type { ErrorCierre, NotaEvolucionContent } from '@healthflow/shared-types';
import { DomainError } from '../../../common/errors/domain.error';
import {
  EstructuraNotaInvalidaError,
  FirmaIncompletaError,
  IncompleteClinicalNoteError,
} from './clinical-note.errors';

/**
 * Auditoría de la edición de notas: SÓLO metadatos.
 *
 * La bitácora dice quién (usuario), cuándo (created_at), sobre qué nota y
 * qué pasó (acción, códigos y rutas de error). Nunca guarda contenido clínico
 * ni valores capturados: el expediente ya los guarda, y duplicarlos en la
 * bitácora sería una segunda copia de datos sensibles con otras reglas de
 * acceso y conservación.
 */

/** Tiempo mínimo entre dos registros de autosave de la misma nota. */
export const VENTANA_AUDITORIA_AUTOSAVE_MS = 5 * 60_000;

/**
 * Huella del contenido para saber si CAMBIÓ, sin poder saber QUÉ dice.
 *
 * HMAC con llave del servidor y no un hash simple: un SHA-256 de un campo
 * corto ("Negados", "120/80") se confirma por diccionario. Truncada a 64 bits,
 * suficiente para detectar cambios y corta a propósito (no es un
 * identificador del contenido ni se parece a una credencial).
 */
export function huellaContenido(contenido: NotaEvolucionContent, llave: string): string {
  return createHmac('sha256', llave).update(JSON.stringify(contenido)).digest('hex').slice(0, 16);
}

export interface UltimaAuditoriaAutosave {
  huella: string | null;
  registradaEn: Date;
}

/**
 * ¿Se registra este autosave? El editor guarda cada ~800 ms mientras se
 * escribe; auditar cada guardado llenaría la bitácora de ruido sin decir nada
 * nuevo. Se registra:
 *   · el primer guardado de la nota;
 *   · después, sólo si el contenido cambió Y pasó la ventana desde el último.
 * Un guardado idéntico nunca se registra, pase el tiempo que pase.
 */
export function debeAuditarAutosave(
  ultima: UltimaAuditoriaAutosave | null,
  huella: string,
  ahora: Date,
  ventanaMs: number = VENTANA_AUDITORIA_AUTOSAVE_MS,
): boolean {
  if (!ultima) return true;
  if (ultima.huella === huella) return false;
  return ahora.getTime() - ultima.registradaEn.getTime() >= ventanaMs;
}

/** Máximo de errores que se detallan en un cierre fallido. */
const MAX_ERRORES_AUDITADOS = 50;

/**
 * Detalle auditable de un cierre rechazado, o null si el error no es un
 * rechazo de dominio de la nota (un 404 o un fallo de infraestructura no es
 * "un intento de cierre fallido" y tiene su propio rastro).
 */
export function detalleCierreFallido(
  error: unknown,
  appointmentId: string,
): Record<string, unknown> | null {
  if (!(error instanceof DomainError)) return null;
  const base = { appointmentId, motivo: error.code };

  if (error instanceof IncompleteClinicalNoteError) {
    return {
      ...base,
      errores: error.errores.slice(0, MAX_ERRORES_AUDITADOS).map(soloMetadatos),
      totalErrores: error.errores.length,
    };
  }
  if (error instanceof EstructuraNotaInvalidaError) {
    return { ...base, rutas: error.rutas.slice(0, MAX_ERRORES_AUDITADOS), totalErrores: error.rutas.length };
  }
  if (error instanceof FirmaIncompletaError) {
    return { ...base, faltantes: error.faltantes };
  }
  if (['NotaDeOtroMedico', 'NoteAlreadyClosed'].includes(error.code)) {
    return base;
  }
  return null;
}

/** Copia explícita campo por campo: si ErrorCierre crece, no se cuela nada nuevo. */
function soloMetadatos(e: ErrorCierre): { codigo: string; ruta: string; reglaId?: string } {
  return e.reglaId ? { codigo: e.codigo, ruta: e.ruta, reglaId: e.reglaId } : { codigo: e.codigo, ruta: e.ruta };
}
