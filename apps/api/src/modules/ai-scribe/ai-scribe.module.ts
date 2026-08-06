import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CaslAbilityFactory } from '../auth/casl/ability.factory';
import { PoliciesGuard } from '../auth/casl/policies.guard';
import { CLINICAL_RECORD_REPOSITORY } from '../clinical-records/domain/clinical-record.repository';
import { DrizzleClinicalRecordRepository } from '../clinical-records/infrastructure/clinical-record.drizzle-repo';
import { ASISTENTE_CLINICO_IA } from './domain/asistente-clinico-ia.port';
import { AsistenteIaActivoReader } from './application/asistente-ia-activo.reader';
import { TranscribirConsultaUseCase } from './application/transcribir-consulta.use-case';
import { GeminiAdapter } from './infrastructure/proveedor/gemini.adapter';
import { FakeAsistenteClinicoIaAdapter } from './infrastructure/proveedor/fake-asistente-ia.adapter';
import { AiScribeController } from './infrastructure/ai-scribe.controller';

/**
 * Asistente de transcripción con IA.
 *
 * El proveedor se elige por entorno con useClass — NUNCA con un `if` dentro
 * del adaptador real que "simule": eso es fácil de dejar prendido en
 * producción. Dev local sin gastar en el modelo: GEMINI_PROVIDER=fake (ya
 * incluido en .env.example).
 */
const usarIaFake = process.env.NODE_ENV === 'test' || process.env.GEMINI_PROVIDER === 'fake';

@Module({
  imports: [AuthModule],
  controllers: [AiScribeController],
  providers: [
    TranscribirConsultaUseCase,
    AsistenteIaActivoReader,
    CaslAbilityFactory,
    PoliciesGuard,
    // Solo lectura de la nota (para saber con qué especialidad se abrió). Se
    // provee aquí en vez de importar ClinicalRecordsModule: importarlo
    // arrastraría sus controllers y casos de uso de escritura, y este módulo
    // no tiene por qué poder tocar el expediente.
    { provide: CLINICAL_RECORD_REPOSITORY, useClass: DrizzleClinicalRecordRepository },
    { provide: ASISTENTE_CLINICO_IA, useClass: usarIaFake ? FakeAsistenteClinicoIaAdapter : GeminiAdapter },
  ],
})
export class AiScribeModule {}
