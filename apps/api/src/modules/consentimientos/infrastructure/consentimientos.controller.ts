import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import type { ConsentimientoView } from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../../auth/casl/policies.guard';
import { ConsentimientosUseCases } from '../application/consentimientos.use-cases';
import { CrearConsentimientoDto } from './dto/consentimiento.dto';

/**
 * Sin PATCH/PUT/DELETE: la ausencia misma de esas rutas es la garantía de
 * inmutabilidad a nivel API (reforzada además por el REVOKE UPDATE/DELETE de
 * la migración 0015).
 */
@Controller('consentimientos')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class ConsentimientosController {
  constructor(private readonly casos: ConsentimientosUseCases) {}

  @Get()
  @RequirePolicy('read', 'Consentimiento')
  listar(@Query('patientId') patientId: string): Promise<ConsentimientoView[]> {
    return this.casos.listarPorPaciente(patientId);
  }

  @Post()
  @RequirePolicy('create', 'Consentimiento')
  crear(@Body() dto: CrearConsentimientoDto): Promise<ConsentimientoView> {
    return this.casos.crear(dto);
  }
}
