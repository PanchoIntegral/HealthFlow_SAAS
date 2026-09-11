import { Injectable } from '@nestjs/common';
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

  async record(tx: Tx, entry: AuditEntry): Promise<void> {
    asegurarDetalleAuditable(entry.detalle);
    const { tenantId, userId } = this.ctx.get();
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
