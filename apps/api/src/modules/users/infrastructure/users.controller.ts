import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import type { UserProfile } from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/authenticated-user';
import { GetUserProfileUseCase } from '../application/get-user-profile.use-case';
import { UpdateEspecialidadUseCase } from '../application/update-especialidad.use-case';
import { ChangePasswordUseCase } from '../application/change-password.use-case';
import { UpdateEspecialidadDto } from './dto/update-especialidad.dto';
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
    private readonly updateEspecialidad: UpdateEspecialidadUseCase,
    private readonly changePassword: ChangePasswordUseCase,
  ) {}

  @Get('me')
  me(@Req() req: { user: AuthenticatedUser }): Promise<UserProfile> {
    return this.getProfile.execute(req.user.userId);
  }

  @Patch('me/especialidad')
  updateMyEspecialidad(
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: UpdateEspecialidadDto,
  ): Promise<UserProfile> {
    return this.updateEspecialidad.execute(req.user.userId, dto);
  }

  @Patch('me/password')
  updateMyPassword(
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: ChangePasswordDto,
  ): Promise<{ ok: true }> {
    return this.changePassword.execute(req.user.userId, dto);
  }
}
