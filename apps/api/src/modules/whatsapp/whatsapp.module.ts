import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { WHATSAPP_CONFIG_REPOSITORY } from './domain/whatsapp-config.repository';
import { WHATSAPP_OUTBOX_REPOSITORY } from './domain/whatsapp-outbox.repository';
import { WHATSAPP_SENDER } from './application/whatsapp-sender.port';
import { GetWhatsappConfigUseCase } from './application/get-whatsapp-config.use-case';
import { SaveWhatsappConfigUseCase } from './application/save-whatsapp-config.use-case';
import { MaterializarRecordatoriosUseCase } from './application/materializar-recordatorios.use-case';
import { DespacharOutboxUseCase } from './application/despachar-outbox.use-case';
import { DrizzleWhatsappConfigRepository } from './infrastructure/whatsapp-config.drizzle-repo';
import { DrizzleWhatsappOutboxRepository } from './infrastructure/whatsapp-outbox.drizzle-repo';
import { FakeWhatsappAdapter } from './infrastructure/sender/fake-whatsapp.adapter';
import { CloudApiWhatsappAdapter } from './infrastructure/sender/cloud-api-whatsapp.adapter';
import { WhatsappConfigController } from './infrastructure/whatsapp-config.controller';
import { WhatsappWebhookController } from './infrastructure/whatsapp-webhook.controller';
import { ProcesarWebhookUseCase } from './application/procesar-webhook.use-case';
import { ConsumoWhatsappUseCase } from './application/consumo-whatsapp.use-case';
import { PurgarEventosUseCase } from './application/purgar-eventos.use-case';
import { ReagendaTokensService } from './application/reagenda-tokens.service';
import { ReagendarCitaUseCase } from './application/reagendar-cita.use-case';
import { ReagendaController } from './infrastructure/reagenda.controller';
import { RecordatoriosScheduler } from './infrastructure/recordatorios.scheduler';

/**
 * Con WHATSAPP_PROVIDER=fake los mensajes se escriben al log en lugar de
 * mandarse: sin red, sin costo y sin depender de que Meta apruebe la plantilla
 * (el trámite tarda de tres días a dos semanas). En los tests siempre falso —
 * mismo criterio que el PAC en billing.module.ts.
 */
const usarWhatsappFake =
  process.env.NODE_ENV === 'test' || process.env.WHATSAPP_PROVIDER === 'fake';

/**
 * Recordatorios de cita por WhatsApp.
 *
 * Importa AuthModule por PoliciesGuard/CaslAbilityFactory: la configuración es
 * cosa del titular de la clínica.
 */
@Module({
  // AppointmentsModule por CancelAppointmentUseCase y el repo de citas: cuando
  // el paciente pulsa "Cancelar" se reutiliza el caso de uso completo, para que
  // el médico reciba su notificación y la sala de espera se actualice igual que
  // si lo hubiera cancelado la recepcionista.
  imports: [AuthModule, AppointmentsModule],
  controllers: [WhatsappConfigController, WhatsappWebhookController, ReagendaController],
  providers: [
    GetWhatsappConfigUseCase,
    SaveWhatsappConfigUseCase,
    MaterializarRecordatoriosUseCase,
    DespacharOutboxUseCase,
    ProcesarWebhookUseCase,
    PurgarEventosUseCase,
    ConsumoWhatsappUseCase,
    ReagendaTokensService,
    ReagendarCitaUseCase,
    RecordatoriosScheduler,
    { provide: WHATSAPP_CONFIG_REPOSITORY, useClass: DrizzleWhatsappConfigRepository },
    { provide: WHATSAPP_OUTBOX_REPOSITORY, useClass: DrizzleWhatsappOutboxRepository },
    {
      provide: WHATSAPP_SENDER,
      useClass: usarWhatsappFake ? FakeWhatsappAdapter : CloudApiWhatsappAdapter,
    },
  ],
  exports: [WHATSAPP_CONFIG_REPOSITORY, WHATSAPP_OUTBOX_REPOSITORY, RecordatoriosScheduler],
})
export class WhatsappModule {}
