import type { AppEventType } from '@healthflow/shared-types';
import type { Tx } from '../../db/drizzle';

/**
 * Un evento interno ya persistido, tal como lo recibe un consumidor.
 * `payload` solo transporta identificadores y estado (ver datos-sensibles.ts).
 */
export interface AppEventEnvelope {
  id: string;
  tenantId: string;
  tipo: AppEventType;
  /** Sube cuando cambia la forma del payload; el consumidor decide qué hacer. */
  version: number;
  entidad: string;
  entidadId: string | null;
  payload: Record<string, unknown>;
  occurredAt: Date;
  /** Cuántas veces se ha intentado ESTE consumidor sobre ESTE evento. */
  attempts: number;
}

/** Lo que se emite; el resto lo pone la base (id, tenant, fechas). */
export interface EmitirEvento {
  tipo: AppEventType;
  entidad: string;
  entidadId?: string | null;
  payload?: Record<string, unknown>;
  version?: number;
  /** Efecto diferido: el despachador no lo entrega antes de esta fecha. */
  availableAt?: Date;
}

/**
 * Un consumidor de eventos internos.
 *
 * `manejar` recibe la transacción del tenant del evento y se ejecuta JUNTO con
 * el cierre del reclamo: o se confirman los dos, o ninguno. Eso convierte el
 * "al menos una vez" del despachador en un efecto exactamente-una-vez, siempre
 * que el manejador escriba dentro de esa misma `tx`.
 *
 * El `nombre` es la clave de idempotencia junto con el id del evento: NO se
 * renombra un consumidor ya desplegado, porque con otro nombre reprocesaría
 * desde cero toda la historia.
 */
export interface AppEventConsumer {
  readonly nombre: string;
  readonly tipos: readonly AppEventType[];
  manejar(evento: AppEventEnvelope, tx: Tx): Promise<void>;
}

/** Token multi-provider: cada módulo registra sus consumidores con él. */
export const APP_EVENT_CONSUMER = 'APP_EVENT_CONSUMER';
