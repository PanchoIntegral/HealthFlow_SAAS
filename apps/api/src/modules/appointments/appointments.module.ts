import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CaslAbilityFactory } from '../auth/casl/ability.factory';
import { PoliciesGuard } from '../auth/casl/policies.guard';
import { APPOINTMENT_REPOSITORY } from './domain/appointment.repository';
import { WAITING_ROOM_NOTIFIER } from './application/waiting-room-notifier.port';
import { CheckInUseCase } from './application/check-in.use-case';
import { ListWaitingRoomUseCase } from './application/list-waiting-room.use-case';
import { ScheduleAppointmentUseCase } from './application/schedule-appointment.use-case';
import { ListAppointmentsUseCase } from './application/list-appointments.use-case';
import { CancelAppointmentUseCase } from './application/cancel-appointment.use-case';
import { RescheduleAppointmentUseCase } from './application/reschedule-appointment.use-case';
// Sin ruta todavía: POST /appointments/:id/no-show es del commit 6. Se
// registra ya porque los consumidores y las pruebas lo necesitan.
import { MarcarNoAsistioUseCase } from './application/marcar-no-asistio.use-case';
import { ListDoctorsUseCase } from './application/list-doctors.use-case';
import { DrizzleAppointmentRepository } from './infrastructure/appointment.drizzle-repo';
import { AppointmentsController } from './infrastructure/appointments.controller';
import { WaitingRoomGateway } from './infrastructure/waiting-room.gateway';
import { MessagingModule } from '../messaging/messaging.module';

/**
 * Cablea el módulo hexagonal: los casos de uso dependen de PUERTOS
 * (APPOINTMENT_REPOSITORY, WAITING_ROOM_NOTIFIER) y aquí se enlazan a sus
 * ADAPTADORES concretos (Drizzle, Socket.io). Cambiar de infraestructura =
 * cambiar solo estas dos líneas de `useClass`.
 */
@Module({
  imports: [AuthModule, NotificationsModule, MessagingModule],
  controllers: [AppointmentsController],
  providers: [
    CheckInUseCase,
    ListWaitingRoomUseCase,
    ScheduleAppointmentUseCase,
    ListAppointmentsUseCase,
    CancelAppointmentUseCase,
    RescheduleAppointmentUseCase,
    MarcarNoAsistioUseCase,
    ListDoctorsUseCase,
    CaslAbilityFactory,
    PoliciesGuard,
    WaitingRoomGateway,
    { provide: APPOINTMENT_REPOSITORY, useClass: DrizzleAppointmentRepository },
    { provide: WAITING_ROOM_NOTIFIER, useExisting: WaitingRoomGateway },
  ],
  // Se exportan para que clinical-records reutilice la transición de cita y la
  // notificación realtime sin re-implementarlas.
  exports: [APPOINTMENT_REPOSITORY, WAITING_ROOM_NOTIFIER],
})
export class AppointmentsModule {}
