import { Controller, Get, UseGuards } from '@nestjs/common';
import type { DashboardStats } from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../../auth/casl/policies.guard';
import { GetDashboardUseCase } from '../application/get-dashboard.use-case';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class DashboardController {
  constructor(private readonly getDashboard: GetDashboardUseCase) {}

  @Get('stats')
  @RequirePolicy('read', 'Dashboard')
  stats(): Promise<DashboardStats> {
    return this.getDashboard.execute();
  }
}
