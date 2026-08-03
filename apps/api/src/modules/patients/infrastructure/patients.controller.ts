import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { HistorialPaciente, PatientSummary } from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../../auth/casl/policies.guard';
import { RegisterPatientUseCase } from '../application/register-patient.use-case';
import { SearchPatientsUseCase } from '../application/search-patients.use-case';
import { UpdateHistorialUseCase } from '../application/update-historial.use-case';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdateHistorialDto } from './dto/update-historial.dto';

@Controller('patients')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class PatientsController {
  constructor(
    private readonly registerPatient: RegisterPatientUseCase,
    private readonly searchPatients: SearchPatientsUseCase,
    private readonly updateHistorial: UpdateHistorialUseCase,
  ) {}

  /** Buscador de pacientes por nombre o CURP. */
  @Get()
  @RequirePolicy('read', 'Patient')
  search(@Query('q') q = ''): Promise<PatientSummary[]> {
    return this.searchPatients.execute(q);
  }

  /** Alta de paciente nuevo. */
  @Post()
  @RequirePolicy('create', 'Patient')
  create(@Body() dto: CreatePatientDto): Promise<PatientSummary> {
    return this.registerPatient.execute(dto);
  }

  /**
   * Alergias y antecedentes. Requiere `write` sobre Patient, que también tiene
   * el asistente: es el dato que se captura en recepción al llenar la ficha, y
   * que llegue completo importa más que quién lo teclea.
   */
  @Patch(':id/historial')
  @RequirePolicy('write', 'Patient')
  historial(
    @Param('id') id: string,
    @Body() dto: UpdateHistorialDto,
  ): Promise<HistorialPaciente> {
    return this.updateHistorial.execute(id, dto);
  }
}
