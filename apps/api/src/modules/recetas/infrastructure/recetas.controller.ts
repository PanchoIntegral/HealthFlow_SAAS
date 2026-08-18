import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import type { RecetaDetalle, RecetaView } from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../../auth/casl/policies.guard';
import { EmitirRecetaUseCase } from '../application/emitir-receta.use-case';
import { ListarRecetasPacienteUseCase } from '../application/listar-recetas-paciente.use-case';
import { GetRecetaDetalleUseCase } from '../application/get-receta-detalle.use-case';
import { CancelarRecetaUseCase } from '../application/cancelar-receta.use-case';
import { CancelarRecetaDto, EmitirRecetaDto } from './dto/receta.dto';

/**
 * Sin PUT/PATCH/DELETE, igual que `ConsentimientosController` y por la misma
 * razón: una receta emitida es inmutable. Si algo está mal se cancela y se
 * emite otra. La ausencia de rutas es la garantía a nivel de API; el REVOKE
 * UPDATE/DELETE de 0028 la refuerza en la base.
 */
@Controller('recetas')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class RecetasController {
  constructor(
    private readonly emitir: EmitirRecetaUseCase,
    private readonly listar: ListarRecetasPacienteUseCase,
    private readonly detalle: GetRecetaDetalleUseCase,
    private readonly cancelarUseCase: CancelarRecetaUseCase,
  ) {}

  @Get()
  @RequirePolicy('read', 'Receta')
  listarPorPaciente(
    @Query('patientId', ParseUUIDPipe) patientId: string,
  ): Promise<RecetaView[]> {
    return this.listar.execute(patientId);
  }

  @Get(':id')
  @RequirePolicy('read', 'Receta')
  obtener(@Param('id', ParseUUIDPipe) id: string): Promise<RecetaDetalle> {
    return this.detalle.execute(id);
  }

  @Post()
  @RequirePolicy('create', 'Receta')
  crear(@Body() dto: EmitirRecetaDto): Promise<RecetaView> {
    return this.emitir.execute({
      patientId: dto.patientId,
      appointmentId: dto.appointmentId,
      diagnosticos: dto.diagnosticos,
      // El DTO deja los campos del RIS opcionales para que sea el validador de
      // dominio quien los reporte por nombre; aquí se normalizan a cadena
      // vacía, que es lo que ese validador entiende como faltante.
      medicamentos: dto.medicamentos.map((m) => ({
        clave: m.clave ?? null,
        denominacionGenerica: m.denominacionGenerica,
        denominacionDistintiva: m.denominacionDistintiva ?? null,
        presentacion: m.presentacion ?? '',
        dosis: m.dosis ?? '',
        via: m.via ?? '',
        frecuencia: m.frecuencia ?? '',
        duracion: m.duracion ?? '',
        indicaciones: m.indicaciones ?? null,
        fraccion: m.fraccion ?? null,
      })),
      indicacionesGenerales: dto.indicacionesGenerales,
    });
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @RequirePolicy('cancel', 'Receta')
  async cancelar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelarRecetaDto,
  ): Promise<{ ok: true }> {
    await this.cancelarUseCase.execute(id, dto.motivo);
    return { ok: true };
  }
}
