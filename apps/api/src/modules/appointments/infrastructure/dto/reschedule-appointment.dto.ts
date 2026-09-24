import { IsISO8601, IsUUID } from 'class-validator';

export class RescheduleAppointmentDto {
  @IsUUID()
  doctorId!: string;

  @IsISO8601()
  inicioProgramado!: string;

  @IsISO8601()
  finProgramado!: string;
}
