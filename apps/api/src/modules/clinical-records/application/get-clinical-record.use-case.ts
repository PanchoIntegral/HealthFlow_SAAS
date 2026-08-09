import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  NOTAS_PAGE_SIZE,
  NOTAS_PAGE_SIZE_MAX,
  type ClinicalRecordView,
} from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import {
  CLINICAL_RECORD_REPOSITORY,
  type ClinicalRecordRepository,
} from '../domain/clinical-record.repository';

/**
 * Expediente de un paciente con una página de su historial (de la nota más
 * reciente hacia atrás). Sin cursor devuelve la primera página.
 */
@Injectable()
export class GetClinicalRecordUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(CLINICAL_RECORD_REPOSITORY) private readonly records: ClinicalRecordRepository,
  ) {}

  async execute(
    patientId: string,
    page: { limit?: number; cursor?: string } = {},
  ): Promise<ClinicalRecordView> {
    // El tope se aplica aquí y no solo en el DTO: cualquier otro llamador del
    // caso de uso queda igual de acotado sin tener que acordarse.
    const limit = Math.min(page.limit ?? NOTAS_PAGE_SIZE, NOTAS_PAGE_SIZE_MAX);
    const view = await this.tenantDb.run((tx) =>
      this.records.getRecordView(tx, patientId, { limit, cursor: page.cursor ?? null }),
    );
    if (!view) throw new NotFoundException('El paciente aún no tiene expediente');
    return view;
  }
}
