import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CaslAbilityFactory } from '../auth/casl/ability.factory';
import { PoliciesGuard } from '../auth/casl/policies.guard';
import { DASHBOARD_REPOSITORY } from './domain/dashboard.repository';
import { GetDashboardUseCase } from './application/get-dashboard.use-case';
import { DrizzleDashboardRepository } from './infrastructure/dashboard.drizzle-repo';
import { DashboardController } from './infrastructure/dashboard.controller';

@Module({
  imports: [AuthModule],
  controllers: [DashboardController],
  providers: [
    GetDashboardUseCase,
    CaslAbilityFactory,
    PoliciesGuard,
    { provide: DASHBOARD_REPOSITORY, useClass: DrizzleDashboardRepository },
  ],
})
export class DashboardModule {}
