import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import type { FeatureFlagView } from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../../auth/casl/policies.guard';
import { FeatureFlagsService } from '../../../common/feature-flags/feature-flags.service';
import { CambiarModuloDto } from './dto/modulo.dto';

/**
 * Activación por clínica de los módulos liberados por etapas (§5.8).
 *
 * Esta ruta NO lleva @RequiereFlag —sería imposible volver a encender un
 * módulo apagado—, y va sobre 'Cuenta': activar un módulo es administración de
 * la cuenta (la decide el titular), no un acto clínico. Por eso el médico que
 * atiende en la clínica tampoco llega: mismo criterio que dar de alta usuarios.
 */
@Controller('modulos')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class ModulosController {
  constructor(private readonly flags: FeatureFlagsService) {}

  /**
   * Sin @RequirePolicy: cualquier usuario autenticado puede saber qué módulos
   * tiene su clínica — es lo que el frontend usa para decidir qué navegación
   * pintar, y el médico y el asistente son justamente quienes los usan. Lo que
   * sí es del titular es CAMBIARLOS.
   */
  @Get()
  listar(): Promise<FeatureFlagView[]> {
    return this.flags.listar();
  }

  @Put()
  @RequirePolicy('manage', 'Cuenta')
  cambiar(@Body() dto: CambiarModuloDto): Promise<FeatureFlagView> {
    return this.flags.establecer(dto.flag, dto.habilitado, dto.notas ?? null);
  }
}
