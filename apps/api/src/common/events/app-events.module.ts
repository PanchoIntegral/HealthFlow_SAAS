import { Global, Module } from '@nestjs/common';
import { AppEventsService } from './app-events.service';
import { AppEventsDispatcher } from './app-events.dispatcher';

/**
 * @Global: emitir un evento es tan transversal como auditar. Los CONSUMIDORES
 * no viven aquí — cada módulo registra los suyos con el token
 * APP_EVENT_CONSUMER (multi: true) y el despachador los recoge.
 */
@Global()
@Module({
  providers: [AppEventsService, AppEventsDispatcher],
  exports: [AppEventsService, AppEventsDispatcher],
})
export class AppEventsModule {}
