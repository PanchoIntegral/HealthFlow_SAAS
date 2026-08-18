import { Inject, Injectable } from '@nestjs/common';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import { AuditService } from '../../../common/audit/audit.service';
import { RecetaNoEncontradaError, RecetaYaCanceladaError } from '../domain/receta.errors';
import { RECETA_REPOSITORY, type RecetaRepository } from '../domain/receta.repository';

/**
 * Cancela una receta emitida.
 *
 * No modifica la receta: inserta una fila en `recetas_cancelaciones`. La
 * receta original queda intacta y legible, que es lo que exige un documento
 * médico-legal que ya circuló — la farmacia puede tener una copia en papel, y
 * lo que se registra es que dejó de ser válida, no que nunca existió.
 */
@Injectable()
export class CancelarRecetaUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    private readonly audit: AuditService,
    @Inject(RECETA_REPOSITORY) private readonly repo: RecetaRepository,
  ) {}

  async execute(id: string, motivo: string): Promise<void> {
    const userId = this.ctx.get().userId;

    return this.tenantDb.run(async (tx) => {
      if (!(await this.repo.existe(tx, id))) throw new RecetaNoEncontradaError();
      if (await this.repo.estaCancelada(tx, id)) throw new RecetaYaCanceladaError();

      await this.repo.cancelar(tx, id, userId, motivo.trim());

      await this.audit.record(tx, {
        entidad: 'receta',
        entidadId: id,
        accion: 'cancelar_receta',
        detalle: { motivo: motivo.trim() },
      });
    });
  }
}
