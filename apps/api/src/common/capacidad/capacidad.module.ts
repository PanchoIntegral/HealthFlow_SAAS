import { Global, Module } from '@nestjs/common';
import { CapacidadService } from './capacidad.service';

/**
 * @Global porque el CapacidadInterceptor se registra como APP_INTERCEPTOR en
 * AppModule, porque cualquier caso de uso de un módulo condicionado necesita
 * el servicio, y porque el despachador de eventos lo consulta antes de
 * entregarle un evento a un consumidor (mismo criterio que SubscriptionModule).
 */
@Global()
@Module({
  providers: [CapacidadService],
  exports: [CapacidadService],
})
export class CapacidadModule {}
