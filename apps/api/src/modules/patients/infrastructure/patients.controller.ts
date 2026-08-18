import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { HistorialPaciente, PatientSummary } from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../../auth/casl/policies.guard';
import { RegisterPatientUseCase } from '../application/register-patient.use-case';
import { SearchPatientsUseCase } from '../application/search-patients.use-case';
import { UpdateHistorialUseCase } from '../application/update-historial.use-case';
import { ActualizarPacienteUseCase } from '../application/actualizar-paciente.use-case';
import { ArchivarPacienteUseCase } from '../application/archivar-paciente.use-case';
import { EliminarPacienteUseCase } from '../application/eliminar-paciente.use-case';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdateHistorialDto } from './dto/update-historial.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';

@Controller('patients')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class PatientsController {
  constructor(
    private readonly registerPatient: RegisterPatientUseCase,
    private readonly searchPatients: SearchPatientsUseCase,
    private readonly updateHistorial: UpdateHistorialUseCase,
    private readonly actualizarPaciente: ActualizarPacienteUseCase,
    private readonly archivarPaciente: ArchivarPacienteUseCase,
    private readonly eliminarPaciente: EliminarPacienteUseCase,
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

  /**
   * Corrige nombre y teléfono. Mismo permiso `write` que el historial, que
   * también tiene el asistente: quien captura la ficha en recepción es quien
   * comete el dedazo y quien debe poder arreglarlo sin esperar al médico.
   */
  @Patch(':id')
  @RequirePolicy('write', 'Patient')
  actualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePatientDto,
  ): Promise<PatientSummary> {
    return this.actualizarPaciente.execute(id, dto);
  }

  /**
   * Baja lógica: sale de búsquedas y listados, el expediente se conserva. Es
   * la operación correcta para "ya no atiendo a este paciente" — la NOM-004
   * obliga a guardar el expediente cinco años desde el último acto médico.
   */
  @Post(':id/archivar')
  @HttpCode(200)
  @RequirePolicy('delete', 'Patient')
  async archivar(@Param('id', ParseUUIDPipe) id: string): Promise<{ ok: true }> {
    await this.archivarPaciente.execute(id, true);
    return { ok: true };
  }

  /** Reversible: archivar por error no debe costar un ticket de soporte. */
  @Post(':id/reactivar')
  @HttpCode(200)
  @RequirePolicy('delete', 'Patient')
  async reactivar(@Param('id', ParseUUIDPipe) id: string): Promise<{ ok: true }> {
    await this.archivarPaciente.execute(id, false);
    return { ok: true };
  }

  /**
   * Borrado real, solo si NUNCA hubo acto médico (duplicado o error de
   * captura). Con expediente responde 409 con el detalle de lo que existe y
   * sugiere archivar; ver EliminarPacienteUseCase.
   */
  @Delete(':id')
  @HttpCode(204)
  @RequirePolicy('delete', 'Patient')
  async eliminar(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.eliminarPaciente.execute(id);
  }
}
