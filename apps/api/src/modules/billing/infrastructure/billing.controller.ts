import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../../auth/casl/policies.guard';
import { TimbrarFacturaUseCase } from '../application/timbrar-factura.use-case';
import { CancelarFacturaUseCase } from '../application/cancelar-factura.use-case';
import { ConsultarFacturaUseCase } from '../application/consultar-factura.use-case';
import { ConsultarFacturaDeCitaUseCase } from '../application/consultar-factura-de-cita.use-case';
import { GetFinanzasUseCase } from '../application/get-finanzas.use-case';
import type { FacturaView } from '../application/factura.views';
import { TimbrarFacturaDto } from './dto/timbrar-factura.dto';
import { CancelarFacturaDto } from './dto/cancelar-factura.dto';

/**
 * Endpoints de facturación. Todos exigen JWT + política CASL de `Factura`
 * (médico y asistente crean/leen; solo médico/admin cancelan). El tenant NUNCA
 * viaja en la URL ni el body: sale del JWT vía RequestContextInterceptor y la
 * cita/factura se resuelven dentro de la transacción con RLS (ajenas ⇒ 404).
 */
@Controller('billing')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class BillingController {
  constructor(
    private readonly timbrarFactura: TimbrarFacturaUseCase,
    private readonly cancelarFactura: CancelarFacturaUseCase,
    private readonly consultarFactura: ConsultarFacturaUseCase,
    private readonly consultarFacturaDeCita: ConsultarFacturaDeCitaUseCase,
    private readonly getFinanzas: GetFinanzasUseCase,
  ) {}

  /** Resumen financiero (ingresos). Subject CASL propio: SOLO médico/admin. */
  @Get('finanzas')
  @RequirePolicy('read', 'Finanzas')
  finanzas() {
    return this.getFinanzas.execute();
  }

  /** Estado de facturación de una cita (última factura o null si no hay). */
  @Get('citas/:appointmentId/factura')
  @RequirePolicy('read', 'Factura')
  facturaDeCita(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
  ): Promise<FacturaView | null> {
    return this.consultarFacturaDeCita.execute(appointmentId);
  }

  /**
   * Timbra el CFDI de una cita. Rate-limited: cada llamada al PAC (exitosa o
   * no) puede tener costo o consumir cuota.
   */
  @Post('facturas')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @RequirePolicy('create', 'Factura')
  timbrar(@Body() dto: TimbrarFacturaDto): Promise<FacturaView> {
    return this.timbrarFactura.execute(dto);
  }

  /** Cancela una factura TIMBRADA con motivo obligatorio (catálogo SAT). */
  @Post('facturas/:id/cancelar')
  @RequirePolicy('cancel', 'Factura')
  cancelar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelarFacturaDto,
  ): Promise<FacturaView> {
    return this.cancelarFactura.execute(id, dto.motivo);
  }

  @Get('facturas/:id')
  @RequirePolicy('read', 'Factura')
  consultar(@Param('id', ParseUUIDPipe) id: string): Promise<FacturaView> {
    return this.consultarFactura.execute(id);
  }
}
