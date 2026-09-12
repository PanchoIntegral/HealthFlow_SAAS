import { Module } from '@nestjs/common';
import { RECALL_REPOSITORY } from './domain/recall.repository';
import { DrizzleRecallRepository } from './infrastructure/recall.drizzle-repo';
import {
  CreateRecallTypeUseCase,
  ListRecallTypesUseCase,
  RecallSettingsUseCases,
  UpdateRecallTypeUseCase,
} from './application/recall-types.use-cases';
import {
  AssignPatientRecallUseCase,
  GenerateRecallFromCompletedTreatmentUseCase,
  GenerateRecallFromNoShowUseCase,
} from './application/recall-asignacion.use-cases';
import {
  DismissRecallUseCase,
  RecordRecallOutcomeUseCase,
  ScheduleRecallAttemptUseCase,
} from './application/recall-contacto.use-cases';
import {
  MatchAppointmentToRecallUseCase,
  UpdateRecallOnAppointmentUseCase,
} from './application/recall-ciclo.use-cases';
import {
  ListRecallWorklistUseCase,
  RecallMetricsUseCase,
} from './application/recall-worklist.use-cases';
import { ProcessDueRecallsUseCase } from './application/procesar-vencimientos.use-case';

/**
 * Recall y reactivación. Sin controllers todavía (commit 6) ni consumidores
 * de eventos (commit 5): este commit deja el dominio, el repositorio y los
 * casos de uso, que es lo que ambos van a necesitar.
 *
 * Se exportan los casos de uso que el worker y los consumidores invocarán
 * desde fuera del módulo.
 */
const CASOS_DE_USO = [
  CreateRecallTypeUseCase,
  UpdateRecallTypeUseCase,
  ListRecallTypesUseCase,
  RecallSettingsUseCases,
  AssignPatientRecallUseCase,
  GenerateRecallFromCompletedTreatmentUseCase,
  GenerateRecallFromNoShowUseCase,
  ScheduleRecallAttemptUseCase,
  RecordRecallOutcomeUseCase,
  DismissRecallUseCase,
  MatchAppointmentToRecallUseCase,
  UpdateRecallOnAppointmentUseCase,
  ListRecallWorklistUseCase,
  RecallMetricsUseCase,
  ProcessDueRecallsUseCase,
];

@Module({
  providers: [
    ...CASOS_DE_USO,
    { provide: RECALL_REPOSITORY, useClass: DrizzleRecallRepository },
  ],
  exports: [...CASOS_DE_USO, RECALL_REPOSITORY],
})
export class RecallsModule {}
