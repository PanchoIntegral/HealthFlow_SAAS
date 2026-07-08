import { Inject, Injectable } from '@nestjs/common';
import type { DashboardStats } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import {
  DASHBOARD_REPOSITORY,
  type DashboardRepository,
} from '../domain/dashboard.repository';

/** Estadísticas del dashboard de la clínica activa. */
@Injectable()
export class GetDashboardUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(DASHBOARD_REPOSITORY) private readonly repo: DashboardRepository,
  ) {}

  execute(): Promise<DashboardStats> {
    return this.tenantDb.run((tx) => this.repo.getStats(tx));
  }
}
