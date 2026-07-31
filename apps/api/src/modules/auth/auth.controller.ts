import { Body, Controller, Get, HttpStatus, Post, Res, UseGuards, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { LoginResponse } from '@healthflow/shared-types';
import { ClientIp } from '../../common/security/client-ip';
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

  /**
   * Endpoint público y el más atacado de la API. Lleva DOS capas de defensa:
   *
   *  1. este límite por IP, en memoria e inmediato — corta la ráfaga antes de
   *     tocar la base de datos o gastar un solo bcrypt;
   *  2. el bloqueo progresivo por email + IP de AuthService, persistido en
   *     Postgres, que sobrevive a los reinicios y a los cambios de instancia.
   *
   * La primera es barata pero olvidadiza; la segunda recuerda. Se necesitan
   * las dos: sin la 1 el atacante nos hace pagar una query por intento, y sin
   * la 2 le basta esperar a un redeploy para reiniciar el contador.
   */
  @Post('login')
  @Throttle({ burst: { limit: 3, ttl: 1_000 }, default: { limit: 10, ttl: 60_000 } })
  login(@Body() dto: LoginDto, @ClientIp() ip: string): Promise<LoginResponse> {
    return this.auth.login(dto.email, dto.password, ip);
  }

  /**
   * Canjea el ticket de un solo uso que llega en el redirect post-pago de
   * Stripe. 200 = sesión lista; 202 = el webhook aún no provisiona la cuenta
   * (el frontend debe reintentar); 410 = ticket expirado o ya usado.
   */
  @Post('exchange-ticket')
  // El ticket es un secreto adivinable por fuerza bruta y canjearlo entrega
  // una sesión: se limita igual que el login. El frontend reintenta mientras
  // llega el webhook de Stripe, así que el techo por minuto deja margen.
  @Throttle({ burst: { limit: 3, ttl: 1_000 }, default: { limit: 20, ttl: 60_000 } })
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
