import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CaslAbilityFactory } from '../auth/casl/ability.factory';
import { PoliciesGuard } from '../auth/casl/policies.guard';
import { PATIENT_REPOSITORY } from './domain/patient.repository';
import { RegisterPatientUseCase } from './application/register-patient.use-case';
import { SearchPatientsUseCase } from './application/search-patients.use-case';
import { DrizzlePatientRepository } from './infrastructure/patient.drizzle-repo';
import { PatientsController } from './infrastructure/patients.controller';

@Module({
  imports: [AuthModule],
  controllers: [PatientsController],
  providers: [
    RegisterPatientUseCase,
    SearchPatientsUseCase,
    CaslAbilityFactory,
    PoliciesGuard,
    { provide: PATIENT_REPOSITORY, useClass: DrizzlePatientRepository },
  ],
})
export class PatientsModule {}
