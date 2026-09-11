import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CaslAbilityFactory } from '../auth/casl/ability.factory';
import { PoliciesGuard } from '../auth/casl/policies.guard';
import { ModulosController } from './infrastructure/modulos.controller';

/** FeatureFlagsService llega por FeatureFlagsModule (@Global). */
@Module({
  imports: [AuthModule],
  controllers: [ModulosController],
  providers: [CaslAbilityFactory, PoliciesGuard],
})
export class ModulosModule {}
