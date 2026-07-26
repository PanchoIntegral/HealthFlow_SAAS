import { Body, Controller, Get, HttpStatus, Post, Res, UseGuards, Req } from '@nestjs/common';
import type { LoginResponse } from '@healthflow/shared-types';
import { AuthService, type ExchangeTicketResult } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ExchangeTicketDto } from './dto/exchange-ticket.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthenticatedUser } from './authenticated-user';

/** Lo mínimo que este controller necesita del response — evita depender del tipo de express. */
interface StatusSettableResponse {
  status(code: number): unknown;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.auth.login(dto.email, dto.password);
  }

  /**
   * Canjea el ticket de un solo uso que llega en el redirect post-pago de
   * Stripe. 200 = sesión lista; 202 = el webhook aún no provisiona la cuenta
   * (el frontend debe reintentar); 410 = ticket expirado o ya usado.
   */
  @Post('exchange-ticket')
  async exchangeTicket(
    @Body() dto: ExchangeTicketDto,
    @Res({ passthrough: true }) res: StatusSettableResponse,
  ): Promise<ExchangeTicketResult> {
    const result = await this.auth.exchangeTicket(dto.stripeSessionId);
    if ('status' in result) {
      res.status(result.status === 'pending' ? HttpStatus.ACCEPTED : HttpStatus.GONE);
      return result;
    }
    res.status(HttpStatus.OK);
    return result;
  }

  /** Devuelve el usuario del token (útil para hidratar la sesión en el front). */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: { user: AuthenticatedUser }): AuthenticatedUser {
    return req.user;
  }
}
