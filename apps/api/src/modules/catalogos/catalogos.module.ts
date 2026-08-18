import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CIE10_REPOSITORY } from './domain/cie10.repository';
import { MEDICAMENTO_REPOSITORY } from './domain/medicamento.repository';
import { BuscarCie10UseCase } from './application/buscar-cie10.use-case';
import { BuscarMedicamentosUseCase } from './application/buscar-medicamentos.use-case';
import { DrizzleCie10Repository } from './infrastructure/cie10.drizzle-repo';
import { DrizzleMedicamentoRepository } from './infrastructure/medicamento.drizzle-repo';
import { CatalogosController } from './infrastructure/catalogos.controller';

@Module({
  imports: [AuthModule],
  controllers: [CatalogosController],
  providers: [
    BuscarCie10UseCase,
    { provide: CIE10_REPOSITORY, useClass: DrizzleCie10Repository },
    BuscarMedicamentosUseCase,
    { provide: MEDICAMENTO_REPOSITORY, useClass: DrizzleMedicamentoRepository },
  ],
})
export class CatalogosModule {}
