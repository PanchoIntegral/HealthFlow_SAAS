import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { CaslAbilityFactory } from '../auth/casl/ability.factory';
import { PoliciesGuard } from '../auth/casl/policies.guard';
import { CLINICAL_RECORD_REPOSITORY } from './domain/clinical-record.repository';
import { StartConsultationUseCase } from './application/start-consultation.use-case';
import { SaveNoteDraftUseCase } from './application/save-note-draft.use-case';
import { FinishConsultationUseCase } from './application/finish-consultation.use-case';
import { GetClinicalRecordUseCase } from './application/get-clinical-record.use-case';
import { GetConsultationNoteUseCase } from './application/get-consultation-note.use-case';
import { DrizzleClinicalRecordRepository } from './infrastructure/clinical-record.drizzle-repo';
import { ConsultationsController } from './infrastructure/consultations.controller';

/**
 * Módulo del expediente clínico. Importa AppointmentsModule para reutilizar sus
 * puertos (APPOINTMENT_REPOSITORY para transicionar la cita, WAITING_ROOM_NOTIFIER
 * para emitir el cambio de estado) — dependencia unidireccional, sin ciclo.
 */
@Module({
  imports: [AuthModule, AppointmentsModule],
  controllers: [ConsultationsController],
  providers: [
    StartConsultationUseCase,
    SaveNoteDraftUseCase,
    FinishConsultationUseCase,
    GetClinicalRecordUseCase,
    GetConsultationNoteUseCase,
    CaslAbilityFactory,
    PoliciesGuard,
    { provide: CLINICAL_RECORD_REPOSITORY, useClass: DrizzleClinicalRecordRepository },
  ],
})
export class ClinicalRecordsModule {}
