import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import type { UserProfile } from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/authenticated-user';
import { GetUserProfileUseCase } from '../application/get-user-profile.use-case';
import { UpdatePerfilUseCase } from '../application/update-perfil.use-case';
import { ChangePasswordUseCase } from '../application/change-password.use-case';
import { UpdatePerfilDto } from './dto/update-perfil.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

/**
 * Perfil del propio usuario autenticado. Autoservicio, no CASL: no es un dato
 * de negocio del tenant sobre el que haya que decidir por rol, es "edita tu
 * propio registro" — mismo criterio que catalogos.controller.ts.
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly getProfile: GetUserProfileUseCase,
    private readonly updatePerfil: UpdatePerfilUseCase,
    private readonly changePassword: ChangePasswordUseCase,
  ) {}

  @Get('me')
  me(@Req() req: { user: AuthenticatedUser }): Promise<UserProfile> {
    return this.getProfile.execute(req.user.userId);
  }

  /**
   * Perfil profesional propio: especialidad + cédula.
   *
   * Responde en dos rutas a propósito. `me/perfil` es el nombre correcto ahora
   * que también lleva la cédula; `me/especialidad` se conserva porque el
   * frontend se despliega por separado del API, y durante ese hueco una versión
   * vieja de la web seguiría llamando a la ruta anterior. Se puede retirar en
   * cuanto todos los clientes desplegados usen la nueva.
   */
  @Patch(['me/perfil', 'me/especialidad'])
  updateMyPerfil(
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: UpdatePerfilDto,
  ): Promise<UserProfile> {
    return this.updatePerfil.execute(req.user.userId, dto);
  }

  @Patch('me/password')
  updateMyPassword(
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: ChangePasswordDto,
  ): Promise<{ ok: true }> {
    return this.changePassword.execute(req.user.userId, dto);
  }
}
