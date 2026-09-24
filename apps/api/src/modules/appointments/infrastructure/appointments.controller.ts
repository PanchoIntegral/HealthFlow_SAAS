import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import type { AppointmentView, DoctorSummary, WaitingRoomEntry } from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../../auth/casl/policies.guard';
import { CheckInUseCase } from '../application/check-in.use-case';
import { ListWaitingRoomUseCase } from '../application/list-waiting-room.use-case';
import { ScheduleAppointmentUseCase } from '../application/schedule-appointment.use-case';
import { ListAppointmentsUseCase } from '../application/list-appointments.use-case';
import { CancelAppointmentUseCase } from '../application/cancel-appointment.use-case';
import { RescheduleAppointmentUseCase } from '../application/reschedule-appointment.use-case';
import { ListDoctorsUseCase } from '../application/list-doctors.use-case';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';

@Controller('appointments')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class AppointmentsController {
  constructor(
    private readonly checkIn: CheckInUseCase,
    private readonly listWaitingRoom: ListWaitingRoomUseCase,
    private readonly scheduleAppointment: ScheduleAppointmentUseCase,
    private readonly listAppointments: ListAppointmentsUseCase,
    private readonly cancelAppointment: CancelAppointmentUseCase,
    private readonly rescheduleAppointment: RescheduleAppointmentUseCase,
    private readonly listDoctors: ListDoctorsUseCase,
  ) {}

  /** Sala de espera del día (carga inicial). */
  @Get('waiting-room')
  @RequirePolicy('read', 'WaitingRoom')
  list(): Promise<WaitingRoomEntry[]> {
    return this.listWaitingRoom.execute();
  }

  /** Médicos de la clínica activa, para el selector de "nueva cita". */
  @Get('doctors')
  @RequirePolicy('read', 'Appointment')
  doctors(): Promise<DoctorSummary[]> {
    return this.listDoctors.execute();
  }

  /** Citas del rango [from, to) para pintar el calendario. */
  @Get()
  @RequirePolicy('read', 'Appointment')
  range(@Query('from') from?: string, @Query('to') to?: string): Promise<AppointmentView[]> {
    if (!from || !to) throw new BadRequestException('from y to son requeridos (ISO datetime)');
    return this.listAppointments.execute(new Date(from), new Date(to));
  }

  /** Agenda una cita nueva. */
  @Post()
  @RequirePolicy('create', 'Appointment')
  schedule(@Body() dto: CreateAppointmentDto): Promise<AppointmentView> {
    return this.scheduleAppointment.execute(dto);
  }

  /** Cambia el horario sin cancelar ni crear otra cita. */
  @Post(':id/reschedule')
  @RequirePolicy('reschedule', 'Appointment')
  reschedule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RescheduleAppointmentDto): Promise<AppointmentView> {
    return this.rescheduleAppointment.execute(id, dto);
  }

  /** Check-in del paciente: agendada → en_espera. Emite evento en tiempo real. */
  @Post(':id/check-in')
  @RequirePolicy('checkin', 'Appointment')
  check(@Param('id', ParseUUIDPipe) id: string): Promise<WaitingRoomEntry> {
    return this.checkIn.execute(id);
  }

  /** Cancela una cita agendada (antes del check-in). */
  @Post(':id/cancel')
  @RequirePolicy('cancel', 'Appointment')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelAppointmentDto,
  ): Promise<AppointmentView> {
    return this.cancelAppointment.execute(id, dto.motivo);
  }
}
