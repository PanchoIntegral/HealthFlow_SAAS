import { Body, Controller, Get, Post, UseGuards, Req } from '@nestjs/common';
import type { LoginResponse } from '@healthflow/shared-types';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthenticatedUser } from './authenticated-user';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.auth.login(dto.email, dto.password);
  }

  /** Devuelve el usuario del token (útil para hidratar la sesión en el front). */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: { user: AuthenticatedUser }): AuthenticatedUser {
    return req.user;
  }
}
