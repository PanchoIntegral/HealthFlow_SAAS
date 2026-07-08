import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import type { PatientSummary } from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../../auth/casl/policies.guard';
import { RegisterPatientUseCase } from '../application/register-patient.use-case';
import { SearchPatientsUseCase } from '../application/search-patients.use-case';
import { CreatePatientDto } from './dto/create-patient.dto';

@Controller('patients')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class PatientsController {
  constructor(
    private readonly registerPatient: RegisterPatientUseCase,
    private readonly searchPatients: SearchPatientsUseCase,
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
}
