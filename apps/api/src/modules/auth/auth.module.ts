import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { env } from '../../config/env';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { CaslAbilityFactory } from './casl/ability.factory';
import { LoginAttemptsService } from './application/login-attempts.service';
import { PasswordHasherService } from './application/password-hasher.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: env.jwtSecret,
      signOptions: { expiresIn: env.jwtExpiresIn },
    }),
    // Provee OnboardingTicketsService para /auth/exchange-ticket (post-pago).
    SubscriptionsModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    CaslAbilityFactory,
    LoginAttemptsService,
    PasswordHasherService,
  ],
  exports: [CaslAbilityFactory, JwtModule],
})
export class AuthModule {}
