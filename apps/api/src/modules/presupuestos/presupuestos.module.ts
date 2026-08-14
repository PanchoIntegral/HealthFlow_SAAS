import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CaslAbilityFactory } from '../auth/casl/ability.factory';
import { PoliciesGuard } from '../auth/casl/policies.guard';
import { AuditModule } from '../../common/audit/audit.module';
import { PRESUPUESTO_REPOSITORY } from './domain/presupuesto.repository';
import { PresupuestosUseCases } from './application/presupuestos.use-cases';
import { ConceptosParaFacturaUseCase } from './application/conceptos-para-factura.use-case';
import { DrizzlePresupuestoRepository } from './infrastructure/presupuesto.drizzle-repo';
import { PresupuestosController } from './infrastructure/presupuestos.controller';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [PresupuestosController],
  providers: [
    PresupuestosUseCases,
    ConceptosParaFacturaUseCase,
    CaslAbilityFactory,
    PoliciesGuard,
    { provide: PRESUPUESTO_REPOSITORY, useClass: DrizzlePresupuestoRepository },
  ],
  // La caja registra el abono al presupuesto dentro de su propia transacción,
  // reusando este agregado en vez de escribir en `presupuesto_abonos` por su
  // cuenta: así las reglas del abono siguen definidas en un solo lugar.
  exports: [PRESUPUESTO_REPOSITORY],
})
export class PresupuestosModule {}
