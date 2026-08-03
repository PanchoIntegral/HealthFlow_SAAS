import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type {
  EstatusPresupuesto,
  PresupuestoView,
  SaldosPorCobrar,
} from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../../auth/casl/policies.guard';
import { PresupuestosUseCases } from '../application/presupuestos.use-cases';
import {
  ConceptosParaFacturaUseCase,
  type ConceptoSugerido,
} from '../application/conceptos-para-factura.use-case';
import {
  CambiarEstatusDto,
  CambiarEstatusPartidaDto,
  CrearPresupuestoDto,
  ReemplazarPartidasDto,
  RegistrarAbonoDto,
} from './dto/presupuesto.dto';

@Controller('presupuestos')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class PresupuestosController {
  constructor(
    private readonly casos: PresupuestosUseCases,
    private readonly conceptos: ConceptosParaFacturaUseCase,
  ) {}

  /** Saldos vivos del consultorio. Va ANTES de :id para que 'saldos' no se
   *  interprete como un identificador. */
  @Get('saldos')
  @RequirePolicy('read', 'Finanzas')
  saldos(): Promise<SaldosPorCobrar> {
    return this.casos.saldosPorCobrar();
  }

  /** Conceptos sugeridos para el CFDI de una cita, desde el trabajo terminado. */
  @Get('conceptos-para-factura')
  @RequirePolicy('create', 'Factura')
  conceptosParaFactura(@Query('appointmentId') appointmentId: string): Promise<ConceptoSugerido[]> {
    return this.conceptos.execute(appointmentId);
  }

  /**
   * Sin `patientId`: lista todos los presupuestos del consultorio (tablero de
   * cobranza). Con `patientId`: solo los de ese paciente (dentro del expediente).
   */
  @Get()
  @RequirePolicy('read', 'Presupuesto')
  listar(
    @Query('patientId') patientId?: string,
    @Query('estatus') estatus?: string,
  ): Promise<PresupuestoView[]> {
    if (patientId) return this.casos.listarPorPaciente(patientId);
    const filtro = estatus
      ? (estatus.split(',').filter(Boolean) as EstatusPresupuesto[])
      : undefined;
    return this.casos.listarTodos(filtro);
  }

  @Get(':id')
  @RequirePolicy('read', 'Presupuesto')
  obtener(@Param('id') id: string): Promise<PresupuestoView> {
    return this.casos.obtener(id);
  }

  @Post()
  @RequirePolicy('create', 'Presupuesto')
  crear(@Body() dto: CrearPresupuestoDto): Promise<PresupuestoView> {
    return this.casos.crear(dto);
  }

  @Patch(':id/partidas')
  @RequirePolicy('write', 'Presupuesto')
  partidas(@Param('id') id: string, @Body() dto: ReemplazarPartidasDto): Promise<PresupuestoView> {
    return this.casos.reemplazarPartidas(id, dto.partidas);
  }

  @Patch(':id/estatus')
  @RequirePolicy('write', 'Presupuesto')
  estatus(@Param('id') id: string, @Body() dto: CambiarEstatusDto): Promise<PresupuestoView> {
    return this.casos.cambiarEstatus(id, dto.estatus);
  }

  @Patch(':id/partidas/:partidaId')
  @RequirePolicy('write', 'Presupuesto')
  estatusPartida(
    @Param('id') id: string,
    @Param('partidaId') partidaId: string,
    @Body() dto: CambiarEstatusPartidaDto,
  ): Promise<PresupuestoView> {
    return this.casos.cambiarEstatusPartida(id, partidaId, dto.estatus, dto.appointmentId);
  }

  /**
   * Registrar un abono es COBRAR, no cotizar: el permiso es `abonar` y lo
   * tiene también el asistente, que es quien recibe el dinero en recepción.
   */
  @Post(':id/abonos')
  @RequirePolicy('abonar', 'Presupuesto')
  abono(@Param('id') id: string, @Body() dto: RegistrarAbonoDto): Promise<PresupuestoView> {
    return this.casos.registrarAbono(id, dto);
  }
}
