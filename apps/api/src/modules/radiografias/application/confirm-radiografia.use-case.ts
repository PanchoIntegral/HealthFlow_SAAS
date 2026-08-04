import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { ConfirmRadiografiaRequest, RadiografiaView } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import { AuditService } from '../../../common/audit/audit.service';
import { ALMACENAMIENTO_PORT, type AlmacenamientoPort } from '../domain/almacenamiento.port';
import { RADIOGRAFIA_REPOSITORY, type RadiografiaRepository } from '../domain/radiografia.repository';

/**
 * Registra en Postgres una imagen que YA se subió a storage (paso de
 * confirmación tras la subida directa). Si el navegador nunca terminó de
 * subir el archivo, este endpoint simplemente nunca se llama — no queda
 * ningún registro huérfano que limpiar.
 */
@Injectable()
export class ConfirmRadiografiaUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    private readonly audit: AuditService,
    @Inject(ALMACENAMIENTO_PORT) private readonly storage: AlmacenamientoPort,
    @Inject(RADIOGRAFIA_REPOSITORY) private readonly repo: RadiografiaRepository,
  ) {}

  async execute(input: ConfirmRadiografiaRequest): Promise<RadiografiaView> {
    // El cliente propone el storageKey (lo recibió de request-upload-url),
    // pero no hay que confiar ciegamente: debe corresponder al tenant y
    // paciente de ESTA petición, o alguien podría confirmar metadata apuntando
    // a un objeto que nunca subió (y del que solo conoce la clave por azar).
    const { tenantId } = this.ctx.get();
    const prefijoEsperado = `tenant/${tenantId}/patients/${input.patientId}/`;
    if (!input.storageKey.startsWith(prefijoEsperado)) {
      throw new BadRequestException('storageKey no corresponde a este paciente');
    }

    return this.tenantDb.run(async (tx) => {
      const row = await this.repo.crear(tx, {
        patientId: input.patientId,
        storageKey: input.storageKey,
        mimeType: input.mimeType,
        subidoPor: this.ctx.get().userId,
      });

      await this.audit.record(tx, {
        entidad: 'radiografia',
        entidadId: row.id,
        accion: 'subir_radiografia',
        detalle: { patientId: input.patientId },
      });

      const url = await this.storage.presignedGetUrl(row.storageKey);
      return {
        id: row.id,
        patientId: row.patientId,
        url,
        mimeType: row.mimeType,
        subidoPorNombre: row.subidoPorNombre,
        createdAt: row.createdAt,
      };
    });
  }
}
