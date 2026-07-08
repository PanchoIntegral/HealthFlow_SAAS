import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CaslAbilityFactory } from '../auth/casl/ability.factory';
import { PoliciesGuard } from '../auth/casl/policies.guard';
import { APPOINTMENT_REPOSITORY } from './domain/appointment.repository';
import { WAITING_ROOM_NOTIFIER } from './application/waiting-room-notifier.port';
import { CheckInUseCase } from './application/check-in.use-case';
import { ListWaitingRoomUseCase } from './application/list-waiting-room.use-case';
import { DrizzleAppointmentRepository } from './infrastructure/appointment.drizzle-repo';
import { AppointmentsController } from './infrastructure/appointments.controller';
import { WaitingRoomGateway } from './infrastructure/waiting-room.gateway';

/**
 * Cablea el módulo hexagonal: los casos de uso dependen de PUERTOS
 * (APPOINTMENT_REPOSITORY, WAITING_ROOM_NOTIFIER) y aquí se enlazan a sus
 * ADAPTADORES concretos (Drizzle, Socket.io). Cambiar de infraestructura =
 * cambiar solo estas dos líneas de `useClass`.
 */
@Module({
  imports: [AuthModule],
  controllers: [AppointmentsController],
  providers: [
    CheckInUseCase,
    ListWaitingRoomUseCase,
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
