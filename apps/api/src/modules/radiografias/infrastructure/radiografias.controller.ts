import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { RadiografiaView, RequestUploadUrlResponse } from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../../auth/casl/policies.guard';
import { RequestUploadUrlUseCase } from '../application/request-upload-url.use-case';
import { ConfirmRadiografiaUseCase } from '../application/confirm-radiografia.use-case';
import { ListarRadiografiasUseCase } from '../application/listar-radiografias.use-case';
import { EliminarRadiografiaUseCase } from '../application/eliminar-radiografia.use-case';
import { RequestUploadUrlDto, ConfirmRadiografiaDto } from './dto/radiografia.dto';

@Controller('radiografias')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class RadiografiasController {
  constructor(
    private readonly requestUploadUrl: RequestUploadUrlUseCase,
    private readonly confirmRadiografia: ConfirmRadiografiaUseCase,
    private readonly listar: ListarRadiografiasUseCase,
    private readonly eliminar: EliminarRadiografiaUseCase,
  ) {}

  @Get()
  @RequirePolicy('read', 'Radiografia')
  listarPorPaciente(@Query('patientId') patientId: string): Promise<RadiografiaView[]> {
    return this.listar.execute(patientId);
  }

  @Post('upload-url')
  @RequirePolicy('create', 'Radiografia')
  uploadUrl(@Body() dto: RequestUploadUrlDto): Promise<RequestUploadUrlResponse> {
    return this.requestUploadUrl.execute(dto);
  }

  @Post()
  @RequirePolicy('create', 'Radiografia')
  crear(@Body() dto: ConfirmRadiografiaDto): Promise<RadiografiaView> {
    return this.confirmRadiografia.execute(dto);
  }

  @Delete(':id')
  @RequirePolicy('delete', 'Radiografia')
  borrar(@Param('id') id: string): Promise<void> {
    return this.eliminar.execute(id);
  }
}
