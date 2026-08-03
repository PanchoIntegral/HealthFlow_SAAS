import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { DiagnosticoCie10, RangoCie10 } from '@healthflow/shared-types';
import { DB } from '../../../db/drizzle.module';
import type { Database } from '../../../db/drizzle';
import type { Cie10Repository } from '../domain/cie10.repository';

interface Cie10Row {
  code: string;
  descripcion: string;
}

/**
 * Adaptador concreto (Drizzle/Postgres) del catálogo CIE-10. Usa `pg_trgm`
 * (índices GIN creados en 0008_cie10.sql) para que ILIKE '%termino%' sea
 * rápido incluso con substrings arbitrarios, y ordena por similitud para que
 * la coincidencia más relevante aparezca primero.
 */
@Injectable()
export class DrizzleCie10Repository implements Cie10Repository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async buscar(
    query: string,
    rangos: readonly RangoCie10[] = [],
    limit = 15,
  ): Promise<DiagnosticoCie10[]> {
    const like = `%${query}%`;
    const result = await this.db.execute(sql`
      SELECT code, descripcion
        FROM cie10_diagnosticos
       WHERE code ILIKE ${like} OR descripcion ILIKE ${like}
       ORDER BY ${this.prioridad(rangos)}similarity(descripcion, ${query}) DESC,
                code ASC
       LIMIT ${limit}
    `);
    return (result.rows as unknown as Cie10Row[]).map((r) => ({
      cie10: r.code,
      descripcion: r.descripcion,
    }));
  }

  /**
   * Término de orden que antepone los códigos de la especialidad: 0 si el
   * código cae en alguno de sus rangos, 1 si no. Incluye la coma final porque
   * sin rangos devuelve VACÍO — así medicina general ejecuta exactamente la
   * misma consulta que antes de existir esta función.
   *
   * Ojo con la tentación de devolver `sql`0`` en el caso vacío: en Postgres
   * `ORDER BY 0` no significa "ordena por la constante cero", significa
   * "ordena por la columna número cero del SELECT" y revienta.
   *
   * El `substring(code, 1, 3)` es indispensable: los códigos traen punto
   * ('K02.1'), y comparar la cadena completa contra el rango dejaría fuera a
   * todos los subcódigos ('K14.9' > 'K14' lexicográficamente).
   */
  private prioridad(rangos: readonly RangoCie10[]): SQL {
    if (rangos.length === 0) return sql.empty();
    const condiciones = rangos.map(
      (r) => sql`substring(code from 1 for 3) BETWEEN ${r.desde} AND ${r.hasta}`,
    );
    return sql`(CASE WHEN ${sql.join(condiciones, sql` OR `)} THEN 0 ELSE 1 END), `;
  }
}
