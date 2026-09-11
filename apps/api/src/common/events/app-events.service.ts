import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../db/drizzle';
import { asegurarPayloadDeEvento } from '../privacidad/datos-sensibles';
import type { EmitirEvento } from './app-event.types';

/**
 * Outbox INTERNA de eventos de aplicación (§14).
 *
 * Se emite DENTRO de la transacción del caso de uso: si la operación de
 * negocio se revierte, el evento se va con ella. Es la única forma de que
 * "terminé la partida" y "hay que sugerir consumo de inventario" no se
 * separen, y evita el doble envío del patrón "escribe y luego publica".
 *
 * No es `outbound_messages` (mensajes al paciente) ni la bitácora de
 * auditoría: esto comunica módulos entre sí y nadie lo lee como historia legal.
 */
@Injectable()
export class AppEventsService {
  async emitir(tx: Tx, evento: EmitirEvento): Promise<string> {
    const payload = evento.payload ?? {};
    asegurarPayloadDeEvento(payload);
    const row = (
      await tx.execute(sql`
        INSERT INTO app_events (tipo, version, entidad, entidad_id, payload, available_at)
        VALUES (${evento.tipo}, ${evento.version ?? 1}, ${evento.entidad},
                ${evento.entidadId ?? null}, ${JSON.stringify(payload)}::jsonb,
                -- coalesce y no DEFAULT: pasar NULL explícito NO dispara el
                -- valor por omisión de la columna, y available_at es NOT NULL.
                coalesce(${evento.availableAt?.toISOString() ?? null}::timestamptz, now()))
        RETURNING id
      `)
    ).rows[0] as unknown as { id: string };
    return row.id;
  }
}
