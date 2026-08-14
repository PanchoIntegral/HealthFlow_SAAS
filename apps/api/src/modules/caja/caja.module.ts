import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CaslAbilityFactory } from '../auth/casl/ability.factory';
import { PoliciesGuard } from '../auth/casl/policies.guard';
import { AuditModule } from '../../common/audit/audit.module';
import { PresupuestosModule } from '../presupuestos/presupuestos.module';
import { TURNO_CAJA_REPOSITORY } from './domain/turno-caja.repository';
import { CajaUseCases } from './application/caja.use-cases';
import { DrizzleTurnoCajaRepository } from './infrastructure/turno-caja.drizzle-repo';
import { CajaController } from './infrastructure/caja.controller';

/**
 * Importa `PresupuestosModule` por su repositorio: un cobro ligado a un
 * presupuesto tiene que generar el abono DENTRO de la misma transacción, y
 * reusar el agregado de cobranza es lo que mantiene una sola definición de
 * las reglas del abono (presupuesto aceptado, monto dentro del saldo).
 */
@Module({
  imports: [AuthModule, AuditModule, PresupuestosModule],
  controllers: [CajaController],
  providers: [
    CajaUseCases,
    CaslAbilityFactory,
    PoliciesGuard,
    { provide: TURNO_CAJA_REPOSITORY, useClass: DrizzleTurnoCajaRepository },
  ],
})
export class CajaModule {}
