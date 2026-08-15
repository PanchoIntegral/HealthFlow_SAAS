import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { CaslAbilityFactory } from '../auth/casl/ability.factory';
import { PoliciesGuard } from '../auth/casl/policies.guard';
import { ORDEN_PLANTILLAS_REPOSITORY } from './domain/orden-plantillas.repository';
import { GetOrCreateOrdenPlantillasUseCase } from './application/get-or-create-orden.use-case';
import { SaveOrdenDraftUseCase } from './application/save-orden-draft.use-case';
import { MarcarOrdenCompletadaUseCase } from './application/marcar-orden-completada.use-case';
import { GetOrdenDetalleUseCase } from './application/get-orden-detalle.use-case';
import { ListOrdenesPacienteUseCase } from './application/list-ordenes-paciente.use-case';
import { DrizzleOrdenPlantillasRepository } from './infrastructure/orden-plantillas.drizzle-repo';
import { PlantillasController } from './infrastructure/plantillas.controller';
import { OrdenesPlantillasController } from './infrastructure/ordenes-plantillas.controller';

/**
 * Módulo de la orden de plantillas ortopédicas. Importa AppointmentsModule
 * para reutilizar APPOINTMENT_REPOSITORY (resolver patientId/doctorId de la
 * cita al crear el borrador) — mismo patrón que ClinicalRecordsModule.
 */
@Module({
  imports: [AuthModule, AuditModule, AppointmentsModule],
  controllers: [PlantillasController, OrdenesPlantillasController],
  providers: [
    GetOrCreateOrdenPlantillasUseCase,
    SaveOrdenDraftUseCase,
    MarcarOrdenCompletadaUseCase,
    GetOrdenDetalleUseCase,
    ListOrdenesPacienteUseCase,
    CaslAbilityFactory,
    PoliciesGuard,
    { provide: ORDEN_PLANTILLAS_REPOSITORY, useClass: DrizzleOrdenPlantillasRepository },
  ],
})
export class PlantillasModule {}
