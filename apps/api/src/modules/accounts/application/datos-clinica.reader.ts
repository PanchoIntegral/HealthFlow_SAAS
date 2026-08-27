import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { CONFIG_RECETA_DEFAULT, type ConfigReceta } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';

export interface DatosClinica {
  nombreClinica: string;
  /** Ya fusionada con los valores por omisión: nunca llega parcial a la UI. */
  configReceta: ConfigReceta;
  direccion: string | null;
  telefono: string | null;
  /** Texto libre para el pie de la receta impresa. */
  leyendaPie: string | null;
  /** Clave de storage del logo, NO url — ver 0031_logo_clinica.sql. */
  logoStorageKey: string | null;
}

/**
 * Dirección, teléfono, logo y leyenda de la clínica activa, para el membrete
 * de documentos impresos (orden de plantillas ortopédicas y receta).
 *
 * Vive en el módulo de cuentas porque es configuración de la clínica —la edita
 * el titular ('admin') desde ahí—, aunque quien lo consuma sea el perfil, la
 * orden de plantillas o la receta. Mismo patrón que ClinicaDentalReader: lector
 * sin estado que recibe la transacción del caso de uso, así que RLS ya limita
 * el SELECT al tenant en curso.
 */
@Injectable()
export class DatosClinicaReader {
  async leer(tx: Tx): Promise<DatosClinica> {
    const result = await tx.execute(sql`
      SELECT nombre_clinica, direccion, telefono, leyenda_pie, logo_storage_key, config_receta
        FROM tenants LIMIT 1
    `);
    const row = (
      result.rows as unknown as {
        nombre_clinica: string;
        config_receta: Partial<ConfigReceta> | null;
        direccion: string | null;
        telefono: string | null;
        leyenda_pie: string | null;
        logo_storage_key: string | null;
      }[]
    )[0];
    return {
      nombreClinica: row?.nombre_clinica ?? '',
      // Fusión con los defaults: una clave que falte (config vieja, opción
      // nueva) toma el valor con el que la receta se imprimía antes.
      configReceta: { ...CONFIG_RECETA_DEFAULT, ...(row?.config_receta ?? {}) },
      direccion: row?.direccion ?? null,
      telefono: row?.telefono ?? null,
      leyendaPie: row?.leyenda_pie ?? null,
      logoStorageKey: row?.logo_storage_key ?? null,
    };
  }
}
