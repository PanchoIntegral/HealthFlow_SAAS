import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import type { OrdenPlantillasView } from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../../auth/casl/policies.guard';
import { GetOrCreateOrdenPlantillasUseCase } from '../application/get-or-create-orden.use-case';

/**
 * Abre (o crea) la orden de plantillas de UNA CITA concreta. Solo GET: es lo
 * único que de verdad necesita el appointmentId (para resolver
 * patientId/doctorId si hay que crearla). Guardar contenido y marcar
 * completada van por el id de la orden — ver `OrdenesPlantillasController` —
 * porque esas acciones también se disparan desde el expediente del paciente,
 * donde no hay ninguna cita en curso.
 */
@Controller('consultations/:appointmentId/orden-plantillas')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class PlantillasController {
  constructor(private readonly getOrCreate: GetOrCreateOrdenPlantillasUseCase) {}

  @Get()
  @RequirePolicy('read', 'Consultation')
  obtener(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
  ): Promise<OrdenPlantillasView> {
    return this.getOrCreate.execute(appointmentId);
  }
}
