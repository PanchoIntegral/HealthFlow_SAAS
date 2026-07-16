import { Controller, Get, UseGuards } from '@nestjs/common';
import type { ReportsStats } from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../../auth/casl/policies.guard';
import { GetReportsUseCase } from '../application/get-reports.use-case';

@Controller('reports')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class ReportsController {
  constructor(private readonly getReports: GetReportsUseCase) {}

  @Get('stats')
  @RequirePolicy('read', 'Reports')
  stats(): Promise<ReportsStats> {
    return this.getReports.execute();
  }
}
