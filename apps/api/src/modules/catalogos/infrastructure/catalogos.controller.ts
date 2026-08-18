import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { DiagnosticoCie10, MedicamentoCatalogo } from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/authenticated-user';
import { BuscarCie10UseCase } from '../application/buscar-cie10.use-case';
import { BuscarMedicamentosUseCase } from '../application/buscar-medicamentos.use-case';

/**
 * Catálogos de referencia (CIE-10, y los que sigan). Solo requieren estar
 * autenticado: no son datos de negocio del tenant ni un subject CASL, son el
 * mismo catálogo público para cualquier clínica.
 */
@Controller('catalogos')
@UseGuards(JwtAuthGuard)
export class CatalogosController {
  constructor(
    private readonly buscarCie10: BuscarCie10UseCase,
    private readonly buscarMedicamentos: BuscarMedicamentosUseCase,
  ) {}

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

  /**
   * Catálogo de medicamentos para prescribir. Devuelve TODAS las fracciones
   * del art. 226, incluidas las que no se pueden emitir: es la UI la que las
   * muestra bloqueadas con el motivo, y el dominio el que rechaza la emisión.
   */
  @Get('medicamentos')
  medicamentos(@Query('q') q?: string): Promise<MedicamentoCatalogo[]> {
    return this.buscarMedicamentos.execute(q ?? '');
  }
}
