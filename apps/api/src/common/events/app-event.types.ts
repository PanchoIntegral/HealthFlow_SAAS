import type { AppEventType, FeatureFlag } from '@healthflow/shared-types';
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
  /**
   * Módulo del que depende este consumidor. Si la clínica no lo tiene
   * disponible, el despachador APLAZA el evento en vez de entregarlo o de
   * cerrarlo: encender el módulo reconcilia solo lo que pasó mientras estuvo
   * apagado (ADR 0004, "Reconciliación").
   *
   * Un consumidor sin módulo (infraestructura) corre siempre.
   */
  readonly moduloRequerido?: FeatureFlag;
  manejar(evento: AppEventEnvelope, tx: Tx): Promise<void>;
}

/**
 * Los consumidores se registran en `AppEventConsumerRegistry` desde el
 * `onModuleInit` de su módulo. NO existe un token multi-provider: Nest no
 * tiene multi-providers, y el que había aquí antes se ignoraba en silencio.
 */

/**
 * Un evento llegó sin los datos que su contrato promete.
 *
 * No se ignora en silencio. Un `return` dejaría la consumición en `done` y el
 * efecto sin ocurrir: el control nunca se crearía, nadie se enteraría, y la
 * clínica vería que "a veces no se generan los seguimientos". Al lanzar, la
 * consumición pasa por los reintentos y acaba en `dead`, que es justamente lo
 * que las alertas del módulo vigilan — un productor que emite mal se ve.
 */
export class PayloadDeEventoIncompletoError extends Error {
  constructor(
    readonly tipo: string,
    readonly eventId: string,
    readonly faltantes: readonly string[],
  ) {
    // Los campos que faltan van PRIMERO: `complete_app_event` recorta el
    // código de error a 80 caracteres, y lo que tiene que sobrevivir a ese
    // recorte es lo accionable, no el prefijo.
    super(`Payload sin ${faltantes.join(', ')} — ${tipo} (${eventId})`);
    this.name = 'PayloadDeEventoIncompletoError';
  }
}

/**
 * Comprueba que el evento traiga lo que el consumidor necesita y devuelve los
 * campos ya tipados. Lanza `PayloadDeEventoIncompletoError` si falta algo.
 *
 * Los nombres de los campos que faltan SÍ van en el mensaje —son nombres de
 * contrato, no datos del paciente—, pero los VALORES nunca.
 */
export function exigirDelEvento<K extends string>(
  evento: AppEventEnvelope,
  campos: readonly K[],
  opciones: { exigeEntidadId?: boolean } = {},
): Record<K, string> {
  const faltantes: string[] = [];
  const resultado = {} as Record<K, string>;
  for (const campo of campos) {
    const valor = evento.payload[campo];
    if (typeof valor === 'string' && valor.length > 0) resultado[campo] = valor;
    else faltantes.push(campo);
  }
  if (opciones.exigeEntidadId !== false && !evento.entidadId) faltantes.push('entidadId');
  if (faltantes.length > 0) {
    throw new PayloadDeEventoIncompletoError(evento.tipo, evento.id, faltantes);
  }
  return resultado;
}
