import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../../db/drizzle';

export interface DatosClinica {
  direccion: string | null;
  telefono: string | null;
}

/**
 * Dirección y teléfono de la clínica activa, para el membrete de documentos
 * impresos (hoy: la orden de plantillas ortopédicas).
 *
 * Vive en el módulo de cuentas porque es configuración de la clínica —la edita
 * el titular ('admin') desde ahí—, aunque quien lo consuma sea el perfil o la
 * orden de plantillas. Mismo patrón que ClinicaDentalReader: lector sin
 * estado que recibe la transacción del caso de uso, así que RLS ya limita el
 * SELECT al tenant en curso.
 */
@Injectable()
export class DatosClinicaReader {
  async leer(tx: Tx): Promise<DatosClinica> {
    const result = await tx.execute(sql`
      SELECT direccion, telefono FROM tenants LIMIT 1
    `);
    const row = (result.rows as unknown as DatosClinica[])[0];
    return { direccion: row?.direccion ?? null, telefono: row?.telefono ?? null };
  }
}
