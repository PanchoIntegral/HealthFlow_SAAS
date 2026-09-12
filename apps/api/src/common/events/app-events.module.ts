import { Global, Module } from '@nestjs/common';
import { AppEventsService } from './app-events.service';
import { AppEventsDispatcher } from './app-events.dispatcher';
import { AppEventConsumerRegistry } from './app-event-consumer.registry';

/**
 * @Global: emitir un evento es tan transversal como auditar. Los CONSUMIDORES
 * no viven aquí — cada módulo registra los suyos en AppEventConsumerRegistry
 * desde su `onModuleInit`, y el despachador los lee de ahí.
 */
@Global()
@Module({
  providers: [AppEventsService, AppEventsDispatcher, AppEventConsumerRegistry],
  exports: [AppEventsService, AppEventsDispatcher, AppEventConsumerRegistry],
})
export class AppEventsModule {}
