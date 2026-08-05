import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { CuentaView, CuentasResumen } from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../../auth/casl/policies.guard';
import { ListarCuentasUseCase } from '../application/listar-cuentas.use-case';
import { CrearCuentaUseCase } from '../application/crear-cuenta.use-case';
import { CambiarEstadoCuentaUseCase } from '../application/cambiar-estado-cuenta.use-case';
import { CrearCuentaDto } from './dto/crear-cuenta.dto';
import { ActualizarCuentaDto } from './dto/actualizar-cuenta.dto';

/**
 * Cuentas del equipo. Todo el controller exige `manage` sobre 'Cuenta', que
 * en CASL solo tiene el titular ('admin'): un médico dado de alta atiende a
 * sus pacientes, no administra la suscripción de la clínica.
 */
@Controller('cuentas')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class AccountsController {
  constructor(
    private readonly listarCuentas: ListarCuentasUseCase,
    private readonly crearCuenta: CrearCuentaUseCase,
    private readonly cambiarEstado: CambiarEstadoCuentaUseCase,
  ) {}

  /** Cuentas + cupos del plan (lo que pinta la pantalla de Cuentas). */
  @Get()
  @RequirePolicy('manage', 'Cuenta')
  list(): Promise<CuentasResumen> {
    return this.listarCuentas.execute();
  }

  /**
   * Alta de un médico o de un asistente.
   *
   * Con límite propio más estricto que el global: cada alta cuesta un hash
   * bcrypt (~100 ms de CPU del hilo principal), y no hay ningún flujo legítimo
   * en el que un titular dé de alta más de un puñado de cuentas por minuto.
   */
  @Post()
  @RequirePolicy('manage', 'Cuenta')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  create(@Body() dto: CrearCuentaDto): Promise<CuentaView> {
    return this.crearCuenta.execute(dto);
  }

  /** Desactiva (o vuelve a habilitar) una cuenta. */
  @Patch(':id')
  @RequirePolicy('manage', 'Cuenta')
  update(@Param('id') id: string, @Body() dto: ActualizarCuentaDto): Promise<CuentaView> {
    return this.cambiarEstado.execute(id, dto.activo);
  }
}
