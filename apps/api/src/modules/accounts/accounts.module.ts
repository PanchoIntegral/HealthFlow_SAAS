import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlanModule } from '../../common/plan/plan.module';
import { RadiografiasModule } from '../radiografias/radiografias.module';
import { CUENTAS_REPOSITORY } from './domain/cuentas.repository';
import { AuditModule } from '../../common/audit/audit.module';
import { ListarCuentasUseCase } from './application/listar-cuentas.use-case';
import { CrearCuentaUseCase } from './application/crear-cuenta.use-case';
import { CambiarEstadoCuentaUseCase } from './application/cambiar-estado-cuenta.use-case';
import { ActualizarDatosClinicaUseCase } from './application/actualizar-datos-clinica.use-case';
import { ObtenerDatosClinicaUseCase } from './application/obtener-datos-clinica.use-case';
import { RequestLogoUploadUrlUseCase } from './application/request-logo-upload-url.use-case';
import { ConfirmLogoUseCase } from './application/confirm-logo.use-case';
import { EliminarLogoUseCase } from './application/eliminar-logo.use-case';
import { DatosClinicaReader } from './application/datos-clinica.reader';
import { DrizzleCuentasRepository } from './infrastructure/cuentas.drizzle-repo';
import { AccountsController } from './infrastructure/accounts.controller';

/**
 * Cuentas del equipo. Importa AuthModule por PasswordHasherService: el alta de
 * una cuenta pasa por el MISMO semáforo de bcrypt que el login, para que un
 * alta no pueda robarle CPU a quien está tratando de entrar.
 *
 * Importa RadiografiasModule por su ALMACENAMIENTO_PORT: el logo de la clínica
 * sube al mismo storage S3-compatible que las radiografías, sin duplicar el
 * adaptador R2/fake.
 */
@Module({
  imports: [AuthModule, PlanModule, AuditModule, RadiografiasModule],
  controllers: [AccountsController],
  providers: [
    ListarCuentasUseCase,
    CrearCuentaUseCase,
    CambiarEstadoCuentaUseCase,
    ActualizarDatosClinicaUseCase,
    ObtenerDatosClinicaUseCase,
    RequestLogoUploadUrlUseCase,
    ConfirmLogoUseCase,
    EliminarLogoUseCase,
    DatosClinicaReader,
    { provide: CUENTAS_REPOSITORY, useClass: DrizzleCuentasRepository },
  ],
})
export class AccountsModule {}
