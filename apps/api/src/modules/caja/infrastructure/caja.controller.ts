import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { TurnoCajaResumen, TurnoCajaView } from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../../auth/casl/policies.guard';
import { CajaUseCases } from '../application/caja.use-cases';
import {
  AbrirCajaDto,
  ActualizarMovimientoCajaDto,
  CancelarMovimientoCajaDto,
  CerrarCajaDto,
  RangoCortesDto,
  RegistrarMovimientoCajaDto,
} from './dto/caja.dto';

@Controller('caja')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class CajaController {
  constructor(private readonly casos: CajaUseCases) {}

  /** El turno abierto, o `null` si la caja del día todavía no se abre. */
  @Get('abierta')
  @RequirePolicy('read', 'Caja')
  abierta(): Promise<TurnoCajaView | null> {
    return this.casos.cajaAbierta();
  }

  /** Histórico de cortes. Va ANTES de :id para que 'turnos' no se lea como id. */
  @Get('turnos')
  @RequirePolicy('read', 'Caja')
  turnos(@Query() rango: RangoCortesDto): Promise<TurnoCajaResumen[]> {
    return this.casos.listarTurnos(rango);
  }

  /** El corte completo de un turno: movimientos, totales y descuadre. */
  @Get('turnos/:id')
  @RequirePolicy('read', 'Caja')
  turno(@Param('id') id: string): Promise<TurnoCajaView> {
    return this.casos.obtenerTurno(id);
  }

  @Post('abrir')
  @RequirePolicy('write', 'Caja')
  abrir(@Body() dto: AbrirCajaDto): Promise<TurnoCajaView> {
    return this.casos.abrir(dto);
  }

  @Post('cerrar')
  @RequirePolicy('write', 'Caja')
  cerrar(@Body() dto: CerrarCajaDto): Promise<TurnoCajaView> {
    return this.casos.cerrar(dto);
  }

  /** Cobrar (o registrar una salida) es la operación de recepción por excelencia. */
  @Post('movimientos')
  @RequirePolicy('create', 'Caja')
  registrar(@Body() dto: RegistrarMovimientoCajaDto): Promise<TurnoCajaView> {
    return this.casos.registrarMovimiento(dto);
  }

  @Patch('movimientos/:id')
  @RequirePolicy('write', 'Caja')
  actualizar(
    @Param('id') id: string,
    @Body() dto: ActualizarMovimientoCajaDto,
  ): Promise<TurnoCajaView> {
    return this.casos.actualizarMovimiento(id, dto);
  }

  /**
   * Cancelar un movimiento es un control interno, no una corrección más: quien
   * cobra no debería poder borrar lo cobrado. Por eso la acción es `cancel` y
   * queda en médico/admin, mismo criterio que la cancelación de facturas.
   */
  @Post('movimientos/:id/cancelar')
  @RequirePolicy('cancel', 'Caja')
  cancelar(
    @Param('id') id: string,
    @Body() dto: CancelarMovimientoCajaDto,
  ): Promise<TurnoCajaView> {
    return this.casos.cancelarMovimiento(id, dto.motivo);
  }
}
