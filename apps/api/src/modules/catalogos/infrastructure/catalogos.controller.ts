import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { DiagnosticoCie10 } from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { BuscarCie10UseCase } from '../application/buscar-cie10.use-case';

/**
 * Catálogos de referencia (CIE-10, y los que sigan). Solo requieren estar
 * autenticado: no son datos de negocio del tenant ni un subject CASL, son el
 * mismo catálogo público para cualquier clínica.
 */
@Controller('catalogos')
@UseGuards(JwtAuthGuard)
export class CatalogosController {
  constructor(private readonly buscarCie10: BuscarCie10UseCase) {}

  @Get('cie10')
  cie10(@Query('q') q?: string): Promise<DiagnosticoCie10[]> {
    return this.buscarCie10.execute(q ?? '');
  }
}
