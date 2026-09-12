import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { auditLog } from '../../db/schema';
import type { Tx } from '../../db/drizzle';
import { RequestContextService } from '../tenant-context/request-context';
import { asegurarDetalleAuditable } from '../privacidad/datos-sensibles';

export interface AuditEntry {
  entidad: string;
  entidadId?: string;
  accion: string;
  detalle?: Record<string, unknown>;
}

/**
 * Actores que no son una persona autenticada. La lista es cerrada a propósito:
 * cada uno es un punto del sistema que escribe sin que nadie haya iniciado
 * sesión, y agregar uno debería costar una revisión.
 */
export type ActorSistema = 'worker' | 'public-booking';

/** El tenant recibido no es el de la transacción en curso. */
export class TenantDeAuditoriaInvalidoError extends Error {
  constructor(recibido: string, activo: string) {
    super(`La auditoría recibió el tenant ${recibido} pero la transacción corre con ${activo}`);
    this.name = 'TenantDeAuditoriaInvalidoError';
  }
}

/**
 * Bitácora de auditoría (NOM-004 / LFPDPPP). Se invoca DENTRO de la misma
 * transacción del caso de uso, de modo que la acción de negocio y su registro
 * de auditoría se confirman o se revierten juntos (atomicidad).
 *
 * El `detalle` pasa por la clasificación de datos (§5.3) ANTES de tocar la
 * base: la bitácora identifica el acto (nombre, CURP, folio, motivo), pero no
 * es un lugar donde puedan acabar credenciales, destinos de contacto ni el
 * cuerpo completo de una nota o del payload de un proveedor. Falla la
 * transacción entera a propósito — un detalle con un token es un bug del caso
 * de uso, y recortarlo en silencio lo dejaría vivo.
 */
@Injectable()
export class AuditService {
  constructor(private readonly ctx: RequestContextService) {}

  /** Acto de una persona autenticada. Toma tenant y usuario del contexto. */
  async record(tx: Tx, entry: AuditEntry): Promise<void> {
    asegurarDetalleAuditable(entry.detalle);
    const { tenantId, userId } = this.ctx.get();
    await this.insertar(tx, tenantId, userId, entry);
  }

  /**
   * Acto del SISTEMA: el worker procesando un evento, o una reserva pública
   * donde no hay sesión.
   *
   * Existe como vía explícita y separada, no como un `catch` dentro de
   * `record`, por dos razones:
   *
   *  1. `record` depende de `RequestContextService`, que fuera de una petición
   *     lanza. Hacer que "se las arregle solo" convertiría un bug real (un
   *     caso de uso invocado desde donde no debía) en una fila de auditoría
   *     mal atribuida y silenciosa.
   *  2. No se fabrica un usuario técnico ni se instala un contexto HTTP falso.
   *     `user_id` queda en NULL, que es la verdad: no hubo persona. Quién fue
   *     el actor de sistema se registra en `detalle.origen`, para poder
   *     distinguir el worker de la reserva pública al investigar.
   *
   * El tenant se recibe EXPLÍCITO y se comprueba contra el de la transacción:
   * el worker cruza tenants, y una auditoría atribuida a la clínica
   * equivocada sería peor que no tenerla.
   */
  async recordSystem(
    tx: Tx,
    tenantId: string,
    entry: AuditEntry,
    origen: ActorSistema,
  ): Promise<void> {
    const detalle = { ...(entry.detalle ?? {}), origen };
    asegurarDetalleAuditable(detalle);

    const fila = (await tx.execute(sql`SELECT current_tenant_id() AS tenant`)).rows[0] as
      | { tenant: string | null }
      | undefined;
    const activo = fila?.tenant ?? null;
    if (activo !== tenantId) {
      throw new TenantDeAuditoriaInvalidoError(tenantId, activo ?? '(ninguno)');
    }

    await this.insertar(tx, tenantId, null, { ...entry, detalle });
  }

  private async insertar(
    tx: Tx,
    tenantId: string,
    userId: string | null,
    entry: AuditEntry,
  ): Promise<void> {
    await tx.insert(auditLog).values({
      tenantId,
      userId,
      entidad: entry.entidad,
      entidadId: entry.entidadId ?? null,
      accion: entry.accion,
      detalle: entry.detalle ?? null,
    });
  }
}
