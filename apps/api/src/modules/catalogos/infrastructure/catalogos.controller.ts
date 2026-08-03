import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { DiagnosticoCie10 } from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/authenticated-user';
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

  /**
   * La especialidad sale del usuario autenticado, NO de un parámetro: así el
   * orden que ve cada médico depende de cómo está dado de alta y no de lo que
   * mande el cliente.
   */
  @Get('cie10')
  cie10(
    @Req() req: { user: AuthenticatedUser },
    @Query('q') q?: string,
  ): Promise<DiagnosticoCie10[]> {
    return this.buscarCie10.execute(q ?? '', req.user.userId);
  }
}
