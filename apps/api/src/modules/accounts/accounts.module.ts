import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlanModule } from '../../common/plan/plan.module';
import { CUENTAS_REPOSITORY } from './domain/cuentas.repository';
import { ListarCuentasUseCase } from './application/listar-cuentas.use-case';
import { CrearCuentaUseCase } from './application/crear-cuenta.use-case';
import { CambiarEstadoCuentaUseCase } from './application/cambiar-estado-cuenta.use-case';
import { DrizzleCuentasRepository } from './infrastructure/cuentas.drizzle-repo';
import { AccountsController } from './infrastructure/accounts.controller';

/**
 * Cuentas del equipo. Importa AuthModule por PasswordHasherService: el alta de
 * una cuenta pasa por el MISMO semáforo de bcrypt que el login, para que un
 * alta no pueda robarle CPU a quien está tratando de entrar.
 */
@Module({
  imports: [AuthModule, PlanModule],
  controllers: [AccountsController],
  providers: [
    ListarCuentasUseCase,
    CrearCuentaUseCase,
    CambiarEstadoCuentaUseCase,
    { provide: CUENTAS_REPOSITORY, useClass: DrizzleCuentasRepository },
  ],
})
export class AccountsModule {}
