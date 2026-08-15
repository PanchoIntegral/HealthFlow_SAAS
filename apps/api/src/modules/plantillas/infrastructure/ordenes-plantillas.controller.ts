import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import type { OrdenPlantillasDetalle, OrdenPlantillasView } from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../../auth/casl/policies.guard';
import { GetOrdenDetalleUseCase } from '../application/get-orden-detalle.use-case';
import { ListOrdenesPacienteUseCase } from '../application/list-ordenes-paciente.use-case';
import { SaveOrdenDraftUseCase } from '../application/save-orden-draft.use-case';
import { MarcarOrdenCompletadaUseCase } from '../application/marcar-orden-completada.use-case';
import { OrdenPlantillasContentDto } from './dto/orden-plantillas-content.dto';

/**
 * Todo lo de una orden que se resuelve por SU PROPIO id, sin depender de una
 * cita en curso: leerla (listado + detalle de impresión), guardar contenido y
 * marcarla completada. Es lo que hace posible llenarla también desde el
 * expediente del paciente — ahí no hay ningún `appointmentId` a la mano.
 * `PlantillasController` (bajo `/consultations/:appointmentId/...`) queda
 * solo para el "ábrela o créala" que sí necesita la cita.
 */
@Controller('ordenes-plantillas')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class OrdenesPlantillasController {
  constructor(
    private readonly getDetalle: GetOrdenDetalleUseCase,
    private readonly listar: ListOrdenesPacienteUseCase,
    private readonly saveDraft: SaveOrdenDraftUseCase,
    private readonly marcarCompletada: MarcarOrdenCompletadaUseCase,
  ) {}

  @Get()
  @RequirePolicy('read', 'Consultation')
  listarPorPaciente(@Query('patientId', ParseUUIDPipe) patientId: string): Promise<OrdenPlantillasView[]> {
    return this.listar.execute(patientId);
  }

  /** Detalle con nombres, para imprimir. */
  @Get(':id')
  @RequirePolicy('read', 'Consultation')
  detalle(@Param('id', ParseUUIDPipe) id: string): Promise<OrdenPlantillasDetalle> {
    return this.getDetalle.execute(id);
  }

  /** Autosave del contenido, desde donde sea que se esté llenando la orden. */
  @Put(':id')
  @RequirePolicy('write', 'Consultation')
  async guardar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OrdenPlantillasContentDto,
  ): Promise<{ ok: true }> {
    await this.saveDraft.execute(id, dto.contenido);
    return { ok: true };
  }

  @Post(':id/marcar-completada')
  @RequirePolicy('write', 'Consultation')
  async completar(@Param('id', ParseUUIDPipe) id: string): Promise<{ ok: true }> {
    await this.marcarCompletada.execute(id);
    return { ok: true };
  }
}
