import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlanModule } from '../../common/plan/plan.module';
import { CaslAbilityFactory } from '../auth/casl/ability.factory';
import { PoliciesGuard } from '../auth/casl/policies.guard';
import { PATIENT_REPOSITORY } from './domain/patient.repository';
import { RegisterPatientUseCase } from './application/register-patient.use-case';
import { SearchPatientsUseCase } from './application/search-patients.use-case';
import { UpdateHistorialUseCase } from './application/update-historial.use-case';
import { ActualizarPacienteUseCase } from './application/actualizar-paciente.use-case';
import { ArchivarPacienteUseCase } from './application/archivar-paciente.use-case';
import { EliminarPacienteUseCase } from './application/eliminar-paciente.use-case';
import { DrizzlePatientRepository } from './infrastructure/patient.drizzle-repo';
import { PatientsController } from './infrastructure/patients.controller';

@Module({
  imports: [AuthModule, PlanModule],
  controllers: [PatientsController],
  providers: [
    RegisterPatientUseCase,
    SearchPatientsUseCase,
    UpdateHistorialUseCase,
    ActualizarPacienteUseCase,
    ArchivarPacienteUseCase,
    EliminarPacienteUseCase,
    CaslAbilityFactory,
    PoliciesGuard,
    { provide: PATIENT_REPOSITORY, useClass: DrizzlePatientRepository },
  ],
})
export class PatientsModule {}
