import { Injectable } from '@nestjs/common';
import { auditLog } from '../../db/schema';
import type { Tx } from '../../db/drizzle';
import { RequestContextService } from '../tenant-context/request-context';

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
 */
@Injectable()
export class AuditService {
  constructor(private readonly ctx: RequestContextService) {}

  async record(tx: Tx, entry: AuditEntry): Promise<void> {
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
