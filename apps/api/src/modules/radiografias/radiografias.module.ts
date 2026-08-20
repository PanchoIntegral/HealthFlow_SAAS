import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { CaslAbilityFactory } from '../auth/casl/ability.factory';
import { PoliciesGuard } from '../auth/casl/policies.guard';
import { ALMACENAMIENTO_PORT } from './domain/almacenamiento.port';
import { RADIOGRAFIA_REPOSITORY } from './domain/radiografia.repository';
import { RequestUploadUrlUseCase } from './application/request-upload-url.use-case';
import { ConfirmRadiografiaUseCase } from './application/confirm-radiografia.use-case';
import { ListarRadiografiasUseCase } from './application/listar-radiografias.use-case';
import { EliminarRadiografiaUseCase } from './application/eliminar-radiografia.use-case';
import { DrizzleRadiografiaRepository } from './infrastructure/radiografia.drizzle-repo';
import { R2Adapter } from './infrastructure/storage/r2.adapter';
import { FakeAlmacenamientoAdapter } from './infrastructure/storage/fake-almacenamiento.adapter';
import { RadiografiasController } from './infrastructure/radiografias.controller';

/**
 * El storage se selecciona por entorno vía useClass — mismo patrón que el PAC
 * de facturación (ver billing.module.ts): NUNCA con un `if` dentro del
 * adaptador real. Dev local sin R2: STORAGE_PROVIDER=fake.
 */
const usarStorageFake =
  process.env.NODE_ENV === 'test' || process.env.STORAGE_PROVIDER === 'fake';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [RadiografiasController],
  providers: [
    RequestUploadUrlUseCase,
    ConfirmRadiografiaUseCase,
    ListarRadiografiasUseCase,
    EliminarRadiografiaUseCase,
    CaslAbilityFactory,
    PoliciesGuard,
    { provide: RADIOGRAFIA_REPOSITORY, useClass: DrizzleRadiografiaRepository },
    { provide: ALMACENAMIENTO_PORT, useClass: usarStorageFake ? FakeAlmacenamientoAdapter : R2Adapter },
  ],
  // El logo de la clínica (módulo accounts) y el snapshot de receta (módulo
  // recetas) reusan el MISMO storage S3-compatible que radiografías, en vez
  // de duplicar el adaptador R2.
  exports: [ALMACENAMIENTO_PORT],
})
export class RadiografiasModule {}
