import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type {
  CuentaView,
  CuentasResumen,
  DatosClinicaView,
  LogoClinicaView,
  RequestLogoUploadUrlResponse,
} from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../../auth/casl/policies.guard';
import { ListarCuentasUseCase } from '../application/listar-cuentas.use-case';
import { CrearCuentaUseCase } from '../application/crear-cuenta.use-case';
import { CambiarEstadoCuentaUseCase } from '../application/cambiar-estado-cuenta.use-case';
import { ActualizarDatosClinicaUseCase } from '../application/actualizar-datos-clinica.use-case';
import { ObtenerDatosClinicaUseCase } from '../application/obtener-datos-clinica.use-case';
import { RequestLogoUploadUrlUseCase } from '../application/request-logo-upload-url.use-case';
import { ConfirmLogoUseCase } from '../application/confirm-logo.use-case';
import { EliminarLogoUseCase } from '../application/eliminar-logo.use-case';
import type { DatosClinica } from '../application/datos-clinica.reader';
import { CrearCuentaDto } from './dto/crear-cuenta.dto';
import { ActualizarCuentaDto } from './dto/actualizar-cuenta.dto';
import { ActualizarDatosClinicaDto } from './dto/actualizar-datos-clinica.dto';
import { ConfirmLogoDto, RequestLogoUploadUrlDto } from './dto/logo-clinica.dto';

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
    private readonly actualizarDatosClinica: ActualizarDatosClinicaUseCase,
    private readonly obtenerDatosClinica: ObtenerDatosClinicaUseCase,
    private readonly requestLogoUploadUrl: RequestLogoUploadUrlUseCase,
    private readonly confirmLogo: ConfirmLogoUseCase,
    private readonly eliminarLogo: EliminarLogoUseCase,
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

  /**
   * Dirección y teléfono de la clínica (membrete de documentos impresos).
   * Ruta ESTÁTICA declarada ANTES de `:id`: Nest resuelve por orden de
   * declaración, y `:id` es un comodín que capturaría "clinica" como si fuera
   * el id de una cuenta si quedara primero.
   */
  @Patch('clinica')
  @RequirePolicy('manage', 'Cuenta')
  actualizarClinica(@Body() dto: ActualizarDatosClinicaDto): Promise<DatosClinica> {
    return this.actualizarDatosClinica.execute(dto);
  }

  /**
   * Dirección, teléfono, logo (resuelto a URL firmada) y leyenda de pie. No
   * expone `logoStorageKey`: es un detalle de storage, no algo que el cliente
   * necesite conocer para mostrar el preview.
   */
  @Get('clinica')
  @RequirePolicy('manage', 'Cuenta')
  async obtenerClinica(): Promise<DatosClinicaView> {
    const { direccion, telefono, leyendaPie, logoUrl } = await this.obtenerDatosClinica.execute();
    return { direccion, telefono, leyendaPie, logoUrl };
  }

  /** Paso 1 de subir el logo: política de subida directa a storage. */
  @Post('clinica/logo/upload-url')
  @RequirePolicy('manage', 'Cuenta')
  logoUploadUrl(@Body() dto: RequestLogoUploadUrlDto): Promise<RequestLogoUploadUrlResponse> {
    return this.requestLogoUploadUrl.execute(dto);
  }

  /** Paso 2: confirma que el logo ya se subió y lo registra en la clínica. */
  @Post('clinica/logo')
  @RequirePolicy('manage', 'Cuenta')
  guardarLogo(@Body() dto: ConfirmLogoDto): Promise<LogoClinicaView> {
    return this.confirmLogo.execute(dto);
  }

  /** Quita el logo de la clínica. */
  @Delete('clinica/logo')
  @RequirePolicy('manage', 'Cuenta')
  borrarLogo(): Promise<void> {
    return this.eliminarLogo.execute();
  }

  /** Desactiva (o vuelve a habilitar) una cuenta. */
  @Patch(':id')
  @RequirePolicy('manage', 'Cuenta')
  update(@Param('id') id: string, @Body() dto: ActualizarCuentaDto): Promise<CuentaView> {
    return this.cambiarEstado.execute(id, dto.activo);
  }
}
