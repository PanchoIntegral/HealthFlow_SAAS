import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CaslAbilityFactory } from '../auth/casl/ability.factory';
import { PoliciesGuard } from '../auth/casl/policies.guard';
import { REPORTS_REPOSITORY } from './domain/reports.repository';
import { GetReportsUseCase } from './application/get-reports.use-case';
import { DrizzleReportsRepository } from './infrastructure/reports.drizzle-repo';
import { ReportsController } from './infrastructure/reports.controller';

@Module({
  imports: [AuthModule],
  controllers: [ReportsController],
  providers: [
    GetReportsUseCase,
    CaslAbilityFactory,
    PoliciesGuard,
    { provide: REPORTS_REPOSITORY, useClass: DrizzleReportsRepository },
  ],
})
export class ReportsModule {}
