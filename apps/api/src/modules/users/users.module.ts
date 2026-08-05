import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { USER_PROFILE_REPOSITORY } from './domain/user-profile.repository';
import { GetUserProfileUseCase } from './application/get-user-profile.use-case';
import { UpdateEspecialidadUseCase } from './application/update-especialidad.use-case';
import { ChangePasswordUseCase } from './application/change-password.use-case';
import { DrizzleUserProfileRepository } from './infrastructure/user-profile.drizzle-repo';
import { UsersController } from './infrastructure/users.controller';

@Module({
  // AuthModule ahora también provee PasswordHasherService (exportado para
  // que "cambiar contraseña" reuse el mismo semáforo de bcrypt que el login).
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [
    GetUserProfileUseCase,
    UpdateEspecialidadUseCase,
    ChangePasswordUseCase,
    { provide: USER_PROFILE_REPOSITORY, useClass: DrizzleUserProfileRepository },
  ],
})
export class UsersModule {}
