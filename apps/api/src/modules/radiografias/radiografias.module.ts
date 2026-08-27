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
import { DiagnosticarStorageUseCase } from './application/diagnosticar-storage.use-case';
import { DrizzleRadiografiaRepository } from './infrastructure/radiografia.drizzle-repo';
import { R2Adapter } from './infrastructure/storage/r2.adapter';
import { FakeAlmacenamientoAdapter } from './infrastructure/storage/fake-almacenamiento.adapter';
import { LocalDiskAlmacenamientoAdapter } from './infrastructure/storage/local-disk.adapter';
import { DevStorageController } from './infrastructure/storage/dev-storage.controller';
import { RadiografiasController } from './infrastructure/radiografias.controller';
import { env } from '../../config/env';

/**
 * El storage se selecciona por entorno vía useClass — mismo patrón que el PAC
 * de facturación (ver billing.module.ts): NUNCA con un `if` dentro del
 * adaptador real. Dev local sin R2: STORAGE_PROVIDER=local (guarda en disco y
 * sirve los archivos desde el propio API); `fake` es solo para pruebas.
 */
const proveedor = process.env.NODE_ENV === 'test' ? 'fake' : env.storageProvider;

const AdaptadorStorage = {
  // En memoria: no persiste ni sirve nada por HTTP. Solo pruebas.
  fake: FakeAlmacenamientoAdapter,
  // Disco + endpoints firmados del propio API. Dev local sin credenciales R2.
  local: LocalDiskAlmacenamientoAdapter,
  r2: R2Adapter,
}[proveedor];

@Module({
  imports: [AuthModule, AuditModule],
  // El "storage" de dev solo existe con STORAGE_PROVIDER=local: en producción
  // esos endpoints no llegan siquiera a registrarse.
  controllers:
    proveedor === 'local' ? [RadiografiasController, DevStorageController] : [RadiografiasController],
  providers: [
    RequestUploadUrlUseCase,
    ConfirmRadiografiaUseCase,
    ListarRadiografiasUseCase,
    EliminarRadiografiaUseCase,
    DiagnosticarStorageUseCase,
    CaslAbilityFactory,
    PoliciesGuard,
    { provide: RADIOGRAFIA_REPOSITORY, useClass: DrizzleRadiografiaRepository },
    { provide: ALMACENAMIENTO_PORT, useClass: AdaptadorStorage },
  ],
  // El logo de la clínica (módulo accounts) y el snapshot de receta (módulo
  // recetas) reusan el MISMO storage S3-compatible que radiografías, en vez
  // de duplicar el adaptador R2.
  exports: [ALMACENAMIENTO_PORT],
})
export class RadiografiasModule {}
