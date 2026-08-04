import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { CaslAbilityFactory } from '../auth/casl/ability.factory';
import { PoliciesGuard } from '../auth/casl/policies.guard';
import { CONSENTIMIENTO_REPOSITORY } from './domain/consentimiento.repository';
import { ConsentimientosUseCases } from './application/consentimientos.use-cases';
import { DrizzleConsentimientoRepository } from './infrastructure/consentimiento.drizzle-repo';
import { ConsentimientosController } from './infrastructure/consentimientos.controller';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [ConsentimientosController],
  providers: [
    ConsentimientosUseCases,
    CaslAbilityFactory,
    PoliciesGuard,
    { provide: CONSENTIMIENTO_REPOSITORY, useClass: DrizzleConsentimientoRepository },
  ],
})
export class ConsentimientosModule {}
