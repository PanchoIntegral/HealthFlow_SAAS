import type { ActorSistema, AuditEntry, AuditService } from '../../../common/audit/audit.service';
import type { Tx } from '../../../db/drizzle';

/**
 * Quién ejecuta un caso de uso de Recall.
 *
 * Los mismos casos de uso se invocan desde una petición (recepción registra
 * una llamada) y desde el worker (un evento cierra un control). En vez de
 * duplicarlos o de que el worker finja un contexto HTTP, el actor es un
 * parámetro explícito y cada camino audita por su vía.
 */
export type ActorRecall =
  | { tipo: 'usuario' }
  | { tipo: 'sistema'; tenantId: string; origen: ActorSistema };

export async function auditar(
  audit: AuditService,
  tx: Tx,
  actor: ActorRecall,
  entry: AuditEntry,
): Promise<void> {
  if (actor.tipo === 'usuario') return audit.record(tx, entry);
  return audit.recordSystem(tx, actor.tenantId, entry, actor.origen);
}

/** Código de PostgreSQL para violación de índice único. */
export function esViolacionDeUnicidad(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505';
}
