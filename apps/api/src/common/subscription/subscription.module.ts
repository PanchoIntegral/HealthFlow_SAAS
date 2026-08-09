import { Global, Module } from '@nestjs/common';
import { EstadoSuscripcionReader } from './estado-suscripcion.reader';

/**
 * @Global porque el SuscripcionInterceptor se registra como APP_INTERCEPTOR
 * en AppModule y necesita resolver el reader desde ahí.
 */
@Global()
@Module({
  providers: [EstadoSuscripcionReader],
  exports: [EstadoSuscripcionReader],
})
export class SubscriptionModule {}
