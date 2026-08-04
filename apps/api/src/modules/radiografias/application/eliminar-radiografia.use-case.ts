import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { AuditService } from '../../../common/audit/audit.service';
import { ALMACENAMIENTO_PORT, type AlmacenamientoPort } from '../domain/almacenamiento.port';
import { RADIOGRAFIA_REPOSITORY, type RadiografiaRepository } from '../domain/radiografia.repository';

@Injectable()
export class EliminarRadiografiaUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    @Inject(ALMACENAMIENTO_PORT) private readonly storage: AlmacenamientoPort,
    @Inject(RADIOGRAFIA_REPOSITORY) private readonly repo: RadiografiaRepository,
  ) {}

  async execute(id: string): Promise<void> {
    const row = await this.tenantDb.run(async (tx) => {
      const eliminada = await this.repo.eliminar(tx, id);
      if (!eliminada) throw new NotFoundException('Radiografía no encontrada');

      await this.audit.record(tx, {
        entidad: 'radiografia',
        entidadId: id,
        accion: 'eliminar_radiografia',
        detalle: { patientId: eliminada.patientId },
      });

      return eliminada;
    });

    // Fuera de la transacción de DB: si el borrado en storage falla, la fila
    // ya no existe en Postgres (que es la fuente de verdad de qué se ve en la
    // UI) — un objeto huérfano en el bucket no es un problema de correctitud.
    await this.storage.eliminar(row.storageKey);
  }
}
