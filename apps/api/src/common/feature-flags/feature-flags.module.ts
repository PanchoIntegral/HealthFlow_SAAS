import { Global, Module } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';

/**
 * @Global porque el FeatureFlagInterceptor se registra como APP_INTERCEPTOR en
 * AppModule y porque cualquier caso de uso de un módulo liberado por etapas
 * necesita el servicio (mismo criterio que SubscriptionModule).
 */
@Global()
@Module({
  providers: [FeatureFlagsService],
  exports: [FeatureFlagsService],
})
export class FeatureFlagsModule {}
