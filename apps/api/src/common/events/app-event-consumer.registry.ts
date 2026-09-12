import { Injectable, Logger } from '@nestjs/common';
import type { AppEventConsumer } from './app-event.types';

/**
 * Dónde viven los consumidores de eventos internos.
 *
 * Existe porque **Nest no tiene multi-providers**. La Fase A registró los
 * consumidores con `{ provide: APP_EVENT_CONSUMER, useClass, multi: true }`,
 * que es sintaxis de Angular: en Nest la propiedad `multi` se ignora, cada
 * registro pisa al anterior, y un token registrado en un módulo ni siquiera es
 * visible desde otro. El despachador recibía `undefined` y no entregaba nada —
 * sin error, sin log, sin nada. Lo descubrió la primera prueba con
 * consumidores reales.
 *
 * El registro es EXPLÍCITO y no por descubrimiento automático: un consumidor
 * empieza a recibir eventos porque alguien lo registró, no porque implemente
 * una interfaz. Y como el nombre es clave de idempotencia junto al id del
 * evento, dos consumidores con el mismo nombre se rechazan: la colisión haría
 * que uno se "comiera" los eventos del otro y ninguno de los dos hiciera su
 * trabajo, en silencio.
 */
@Injectable()
export class AppEventConsumerRegistry {
  private readonly logger = new Logger(AppEventConsumerRegistry.name);
  private readonly porNombre = new Map<string, AppEventConsumer>();

  registrar(...consumidores: AppEventConsumer[]): void {
    for (const consumidor of consumidores) {
      const previo = this.porNombre.get(consumidor.nombre);
      if (previo && previo !== consumidor) {
        throw new Error(
          `Ya hay un consumidor registrado con el nombre '${consumidor.nombre}'. ` +
            'El nombre es clave de idempotencia: dos consumidores no pueden compartirlo.',
        );
      }
      if (!previo) {
        this.porNombre.set(consumidor.nombre, consumidor);
        this.logger.log(`Consumidor registrado: ${consumidor.nombre}`);
      }
    }
  }

  get todos(): readonly AppEventConsumer[] {
    return [...this.porNombre.values()];
  }
}
