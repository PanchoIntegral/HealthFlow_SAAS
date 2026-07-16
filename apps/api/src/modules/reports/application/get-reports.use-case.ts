import { Inject, Injectable } from '@nestjs/common';
import type { ReportsStats } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { REPORTS_REPOSITORY, type ReportsRepository } from '../domain/reports.repository';

/** Estadísticas avanzadas de la clínica activa. */
@Injectable()
export class GetReportsUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(REPORTS_REPOSITORY) private readonly repo: ReportsRepository,
  ) {}

  execute(): Promise<ReportsStats> {
    return this.tenantDb.run((tx) => this.repo.getStats(tx));
  }
}
