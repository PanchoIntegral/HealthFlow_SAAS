import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateAppointmentDto {
  @IsUUID()
  patientId!: string;

  @IsUUID()
  doctorId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  motivo?: string;

  @IsISO8601()
  inicioProgramado!: string;

  @IsISO8601()
  finProgramado!: string;
}
