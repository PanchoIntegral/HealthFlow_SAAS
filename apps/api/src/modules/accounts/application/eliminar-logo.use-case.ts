import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { AuditService } from '../../../common/audit/audit.service';
import { ALMACENAMIENTO_PORT, type AlmacenamientoPort } from '../../radiografias/domain/almacenamiento.port';
import { DatosClinicaReader } from './datos-clinica.reader';

/** Quita el logo de la clínica: borra el objeto de storage y limpia la columna. */
@Injectable()
export class EliminarLogoUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    private readonly datosClinica: DatosClinicaReader,
    @Inject(ALMACENAMIENTO_PORT) private readonly storage: AlmacenamientoPort,
  ) {}

  async execute(): Promise<void> {
    return this.tenantDb.run(async (tx) => {
      const anterior = await this.datosClinica.leer(tx);
      if (!anterior.logoStorageKey) return;

      await tx.execute(sql`UPDATE tenants SET logo_storage_key = NULL`);
      await this.storage.eliminar(anterior.logoStorageKey);

      await this.audit.record(tx, {
        entidad: 'tenant',
        accion: 'eliminar_logo',
        detalle: {},
      });
    });
  }
}
