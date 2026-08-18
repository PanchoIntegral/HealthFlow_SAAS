import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { CaslAbilityFactory } from '../auth/casl/ability.factory';
import { PoliciesGuard } from '../auth/casl/policies.guard';
import { RECETA_REPOSITORY } from './domain/receta.repository';
import { EmitirRecetaUseCase } from './application/emitir-receta.use-case';
import { ListarRecetasPacienteUseCase } from './application/listar-recetas-paciente.use-case';
import { GetRecetaDetalleUseCase } from './application/get-receta-detalle.use-case';
import { CancelarRecetaUseCase } from './application/cancelar-receta.use-case';
import { DrizzleRecetaRepository } from './infrastructure/receta.drizzle-repo';
import { RecetasController } from './infrastructure/recetas.controller';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [RecetasController],
  providers: [
    EmitirRecetaUseCase,
    ListarRecetasPacienteUseCase,
    GetRecetaDetalleUseCase,
    CancelarRecetaUseCase,
    CaslAbilityFactory,
    PoliciesGuard,
    { provide: RECETA_REPOSITORY, useClass: DrizzleRecetaRepository },
  ],
})
export class RecetasModule {}
