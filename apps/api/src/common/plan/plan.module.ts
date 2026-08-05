import { Module } from '@nestjs/common';
import { PlanService } from './plan.service';

/** Provee PlanService a cualquier módulo que tenga que respetar un cupo. */
@Module({
  providers: [PlanService],
  exports: [PlanService],
})
export class PlanModule {}
