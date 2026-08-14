import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../../db/drizzle';

/**
 * ¿La clínica activa ejerce odontología?
 *
 * Se deduce de los usuarios y no de una columna en `tenants` porque no hay tal
 * columna: la especialidad se captura por médico (`users.especialidad_key`), y
 * una clínica puede tener varios. Basta uno dental para que el consultorio lo
 * sea a efectos de la interfaz.
 *
 * Vive en el módulo de presupuestos porque es su regla —los presupuestos por
 * pieza son odontológicos— aunque quien lo consuma hoy sea el perfil. Mismo
 * patrón que AsistenteIaActivoReader: lector sin estado que recibe la
 * transacción del caso de uso, así que RLS ya limita el SELECT a la clínica en
 * curso.
 */
@Injectable()
export class ClinicaDentalReader {
  async leer(tx: Tx): Promise<boolean> {
    const result = await tx.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM users WHERE especialidad_key = 'odontologia'
      ) AS dental
    `);
    const row = (result.rows as unknown as { dental: boolean }[])[0];
    // Sin fila (no debería pasar) ⇒ no dental. El default seguro es esconder
    // una función que no aplica, no mostrar campos que nadie sabrá llenar.
    return row?.dental ?? false;
  }
}
