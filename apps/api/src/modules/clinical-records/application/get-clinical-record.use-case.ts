import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ClinicalRecordView } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import {
  CLINICAL_RECORD_REPOSITORY,
  type ClinicalRecordRepository,
} from '../domain/clinical-record.repository';

/** Expediente completo de un paciente (record + todas sus notas). */
@Injectable()
export class GetClinicalRecordUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(CLINICAL_RECORD_REPOSITORY) private readonly records: ClinicalRecordRepository,
  ) {}

  async execute(patientId: string): Promise<ClinicalRecordView> {
    const view = await this.tenantDb.run((tx) => this.records.getRecordView(tx, patientId));
    if (!view) throw new NotFoundException('El paciente aún no tiene expediente');
    return view;
  }
}
