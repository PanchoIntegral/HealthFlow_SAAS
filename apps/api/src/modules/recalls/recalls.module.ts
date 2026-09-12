import { Module, type OnModuleInit } from '@nestjs/common';
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
import { AppEventConsumerRegistry } from '../../common/events/app-event-consumer.registry';
import {
  CicloDeCitaConsumer,
  GenerarRecallPorTratamientoConsumer,
  ReactivarPorNoShowConsumer,
  VincularCitaConRecallConsumer,
} from './application/recall.consumers';

/**
 * Recall y reactivación. Sin controllers todavía (commit 6): este módulo deja
 * el dominio, el repositorio, los casos de uso y los consumidores de eventos.
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

const CONSUMIDORES = [
  GenerarRecallPorTratamientoConsumer,
  VincularCitaConRecallConsumer,
  CicloDeCitaConsumer,
  ReactivarPorNoShowConsumer,
];

@Module({
  providers: [
    ...CASOS_DE_USO,
    ...CONSUMIDORES,
    { provide: RECALL_REPOSITORY, useClass: DrizzleRecallRepository },
  ],
  exports: [...CASOS_DE_USO, RECALL_REPOSITORY],
})
export class RecallsModule implements OnModuleInit {
  constructor(
    private readonly registro: AppEventConsumerRegistry,
    private readonly tratamiento: GenerarRecallPorTratamientoConsumer,
    private readonly vincular: VincularCitaConRecallConsumer,
    private readonly ciclo: CicloDeCitaConsumer,
    private readonly noShow: ReactivarPorNoShowConsumer,
  ) {}

  /**
   * El registro es explícito y aquí. Nest no tiene multi-providers —la Fase A
   * lo dio por hecho y el despachador se quedaba sin consumidores, en
   * silencio—, así que cada módulo declara los suyos al arrancar.
   */
  onModuleInit(): void {
    this.registro.registrar(this.tratamiento, this.vincular, this.ciclo, this.noShow);
  }
}
