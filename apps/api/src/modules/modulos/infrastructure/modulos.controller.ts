import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import type { ModuloView } from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../../auth/casl/policies.guard';
import { CapacidadService } from '../../../common/capacidad/capacidad.service';
import { CambiarModuloDto } from './dto/modulo.dto';

/**
 * CONFIGURACIÓN por clínica de los módulos. Uno de los cuatro ejes de la
 * capacidad efectiva (ADR 0004): aquí el titular dice si QUIERE usar lo que
 * tiene disponible.
 *
 * Lo que esta ruta NO puede hacer, y es el punto del diseño: conceder el
 * derecho a un módulo. Eso vive en `tenant_module_entitlements`, sobre la que
 * el rol de la aplicación sólo tiene SELECT — un INSERT desde aquí es
 * `permission denied` en PostgreSQL, no un `if` que alguien pueda olvidar.
 * Tampoco levanta un rollback (`rollout_habilitado`), cuya columna tiene el
 * UPDATE revocado.
 *
 * Sin @RequiereModulo —sería imposible volver a encender un módulo apagado—, y
 * sobre 'Cuenta': configurar módulos es administración de la cuenta (la decide
 * el titular), no un acto clínico. Por eso el médico que atiende en la clínica
 * tampoco llega: mismo criterio que dar de alta usuarios.
 */
@Controller('modulos')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class ModulosController {
  constructor(private readonly capacidad: CapacidadService) {}

  /**
   * Sin @RequirePolicy: cualquier usuario autenticado puede saber qué módulos
   * tiene su clínica — es lo que el frontend usa para decidir qué navegación
   * pintar, y el médico y el asistente son justamente quienes los usan. Lo que
   * sí es del titular es CAMBIARLOS.
   */
  @Get()
  listar(): Promise<ModuloView[]> {
    return this.capacidad.listar();
  }

  @Put()
  @RequirePolicy('manage', 'Cuenta')
  cambiar(@Body() dto: CambiarModuloDto): Promise<ModuloView> {
    return this.capacidad.configurar(dto.flag, dto.habilitado, dto.notas ?? null);
  }
}
