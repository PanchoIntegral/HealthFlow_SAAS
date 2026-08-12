import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Database } from '../../../db/drizzle';
import { DB } from '../../../db/drizzle.module';

/**
 * Cuánto se conserva el registro de eventos de Meta.
 *
 * La tabla existe solo para no procesar dos veces el mismo evento cuando Meta
 * reintenta, y Meta deja de reintentar mucho antes de las 24 horas. Una semana
 * da margen de sobra y además deja rastro para depurar una entrega rara.
 */
const DIAS_RETENCION = 7;

/**
 * Tira los eventos de Meta ya procesados que son demasiado viejos para servir
 * de nada.
 *
 * `whatsapp_events` no tiene tenant ni RLS —cuando el evento llega todavía no
 * se sabe de qué clínica es—, así que se accede con la conexión sin
 * transacción de tenant. Es seguro porque la tabla no contiene datos de nadie:
 * solo el hash del cuerpo y una etiqueta de tipo.
 *
 * Los eventos SIN procesar no se tocan: si uno falló, su marca ya se borró
 * para que el reintento de Meta lo vuelva a traer, y si sigue ahí sin procesar
 * es una señal que conviene poder ver.
 */
@Injectable()
export class PurgarEventosUseCase {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Devuelve cuántas filas se borraron. */
  async execute(ahora: Date = new Date()): Promise<number> {
    const limite = new Date(ahora.getTime() - DIAS_RETENCION * 24 * 60 * 60 * 1000);
    const result = await this.db.execute(sql`
      DELETE FROM whatsapp_events
       WHERE processed_at IS NOT NULL
         AND recibido_at < ${limite.toISOString()}
      RETURNING id
    `);
    return result.rows.length;
  }
}
