import { Controller, Get, Param, Post, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import type { WaitingRoomEntry } from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../../auth/casl/policies.guard';
import { CheckInUseCase } from '../application/check-in.use-case';
import { ListWaitingRoomUseCase } from '../application/list-waiting-room.use-case';

@Controller('appointments')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class AppointmentsController {
  constructor(
    private readonly checkIn: CheckInUseCase,
    private readonly listWaitingRoom: ListWaitingRoomUseCase,
  ) {}

  /** Sala de espera del día (carga inicial). */
  @Get('waiting-room')
  @RequirePolicy('read', 'WaitingRoom')
  list(): Promise<WaitingRoomEntry[]> {
    return this.listWaitingRoom.execute();
  }

  /** Check-in del paciente: agendada → en_espera. Emite evento en tiempo real. */
  @Post(':id/check-in')
  @RequirePolicy('checkin', 'Appointment')
  check(@Param('id', ParseUUIDPipe) id: string): Promise<WaitingRoomEntry> {
    return this.checkIn.execute(id);
  }
}
