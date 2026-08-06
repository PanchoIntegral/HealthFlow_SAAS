import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../../db/drizzle';

/**
 * ¿La clínica activa tiene prendido el asistente de IA?
 *
 * Lector propio y no una extensión de PlanService: ese servicio traduce
 * `tenants.plan` a los cupos que se venden, y esto es un interruptor de
 * función. Mezclarlos haría que mañana un cambio de precios tuviera que
 * pensar en transcripciones.
 *
 * Recibe la transacción del caso de uso: el SELECT corre con el tenant fijado,
 * así que RLS ya limita la fila a la clínica en curso.
 */
@Injectable()
export class AsistenteIaActivoReader {
  async leer(tx: Tx): Promise<boolean> {
    const result = await tx.execute(sql`SELECT asistente_ia_activo FROM tenants LIMIT 1`);
    const row = (result.rows as unknown as { asistente_ia_activo: boolean }[])[0];
    // Sin fila (no debería pasar con RLS bien puesto) ⇒ apagado. El default
    // seguro para una función que manda datos clínicos a un tercero es "no".
    return row?.asistente_ia_activo ?? false;
  }
}
