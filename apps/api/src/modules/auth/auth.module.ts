import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { env } from '../../config/env';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { CaslModule } from './casl/casl.module';
import { LoginAttemptsService } from './application/login-attempts.service';
import { PasswordHasherService } from './application/password-hasher.service';
import { EMAIL_PORT } from './domain/email.port';
import { ResendAdapter } from './infrastructure/email/resend.adapter';
import { FakeEmailAdapter } from './infrastructure/email/fake-email.adapter';

/**
 * El correo se selecciona por entorno vía useClass — mismo patrón que el PAC
 * de facturación (billing.module.ts) y el storage de radiografías: NUNCA con
 * un `if` dentro del adaptador real. Dev local sin Resend: EMAIL_PROVIDER=fake.
 */
const usarEmailFake = process.env.NODE_ENV === 'test' || process.env.EMAIL_PROVIDER === 'fake';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: env.jwtSecret,
      signOptions: { expiresIn: env.jwtExpiresIn },
    }),
    // Provee OnboardingTicketsService para /auth/exchange-ticket (post-pago).
    SubscriptionsModule,
    CaslModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    LoginAttemptsService,
    PasswordHasherService,
    { provide: EMAIL_PORT, useClass: usarEmailFake ? FakeEmailAdapter : ResendAdapter },
  ],
  // PasswordHasherService se exporta para que el módulo `users` la reuse en
  // "cambiar contraseña" — un solo semáforo de bcrypt para todo el proceso.
  //
  // CaslModule se REEXPORTA (en vez de exportar la fábrica suelta) para que
  // los módulos que ya importaban AuthModule por `@RequirePolicy` no tengan
  // que cambiar nada.
  exports: [CaslModule, JwtModule, PasswordHasherService],
})
export class AuthModule {}
