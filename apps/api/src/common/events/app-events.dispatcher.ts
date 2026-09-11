import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { isAppEventType, type AppEventType } from '@healthflow/shared-types';
import { DB } from '../../db/drizzle.module';
import { runInTenant, type Database } from '../../db/drizzle';
import { APP_EVENT_CONSUMER, type AppEventConsumer, type AppEventEnvelope } from './app-event.types';

interface FilaReclamada {
  id: string;
  tenant_id: string;
  tipo: string;
  version: number;
  entidad: string;
  entidad_id: string | null;
  payload: Record<string, unknown>;
  occurred_at: Date | string;
  attempts: number;
}

/**
 * Entrega los eventos internos a sus consumidores. Lo invoca el worker, no el
 * ciclo de una petición.
 *
 * Modelo de entrega, en tres pasos deliberados:
 *
 *  1. `claim_app_events(consumidor, n)` — commit propio. Marca el reclamo para
 *     que otro worker no tome los mismos eventos. La exclusión mutua la da el
 *     índice único (event_id, consumer), no un lock en memoria.
 *  2. manejador + `complete_app_event(..., true)` en UNA transacción del tenant
 *     del evento: el efecto de negocio y el "ya lo procesé" se confirman
 *     juntos. Ahí está la garantía de exactamente-una-vez.
 *  3. si el manejador falla, se cierra FUERA de esa transacción (que ya se
 *     revirtió) con backoff; a los 8 intentos el reclamo queda 'dead' y deja
 *     de girar.
 *
 * Cada consumidor avanza por su cuenta: que el de inventario esté roto no
 * detiene al de recalls.
 */
@Injectable()
export class AppEventsDispatcher {
  private readonly logger = new Logger(AppEventsDispatcher.name);
  private readonly consumidores: AppEventConsumer[];

  constructor(
    @Inject(DB) private readonly db: Database,
    @Optional() @Inject(APP_EVENT_CONSUMER) consumidores?: AppEventConsumer[] | AppEventConsumer,
  ) {
    this.consumidores = consumidores ? ([] as AppEventConsumer[]).concat(consumidores) : [];
  }

  /** Una vuelta completa. Devuelve cuántos eventos se entregaron. */
  async tick(lotePorConsumidor = 20): Promise<number> {
    let total = 0;
    for (const consumidor of this.consumidores) {
      total += await this.tickConsumidor(consumidor, lotePorConsumidor);
    }
    return total;
  }

  private async tickConsumidor(consumidor: AppEventConsumer, limite: number): Promise<number> {
    const filas = (
      await this.db.execute(sql`SELECT * FROM claim_app_events(${consumidor.nombre}, ${limite})`)
    ).rows as unknown as FilaReclamada[];

    let entregados = 0;
    for (const fila of filas) {
      // Un consumidor solo declara los tipos que le importan; el resto se
      // cierra de inmediato para que no vuelva a aparecer en su cola.
      if (!consumidor.tipos.includes(fila.tipo as AppEventType) || !isAppEventType(fila.tipo)) {
        await this.cerrar(fila.id, consumidor.nombre, true, null);
        continue;
      }
      const evento = aEnvelope(fila);
      try {
        await runInTenant(this.db, fila.tenant_id, async (tx) => {
          await consumidor.manejar(evento, tx);
          await tx.execute(
            sql`SELECT complete_app_event(${fila.id}, ${consumidor.nombre}, true, NULL)`,
          );
        });
        entregados++;
      } catch (error) {
        const code = error instanceof Error ? error.message.slice(0, 80) : 'consumer_error';
        this.logger.warn(`${consumidor.nombre} falló en ${fila.tipo} (${fila.id}): ${code}`);
        await this.cerrar(fila.id, consumidor.nombre, false, code);
      }
    }
    return entregados;
  }

  private async cerrar(
    eventId: string,
    consumidor: string,
    ok: boolean,
    code: string | null,
  ): Promise<void> {
    await this.db.execute(sql`SELECT complete_app_event(${eventId}, ${consumidor}, ${ok}, ${code})`);
  }
}

function aEnvelope(fila: FilaReclamada): AppEventEnvelope {
  return {
    id: fila.id,
    tenantId: fila.tenant_id,
    tipo: fila.tipo as AppEventType,
    version: fila.version,
    entidad: fila.entidad,
    entidadId: fila.entidad_id,
    payload: fila.payload ?? {},
    occurredAt: new Date(fila.occurred_at),
    attempts: fila.attempts,
  };
}
