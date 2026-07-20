import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { DiagnosticoCie10 } from '@healthflow/shared-types';
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

  async buscar(query: string, limit = 15): Promise<DiagnosticoCie10[]> {
    const like = `%${query}%`;
    const result = await this.db.execute(sql`
      SELECT code, descripcion
        FROM cie10_diagnosticos
       WHERE code ILIKE ${like} OR descripcion ILIKE ${like}
       ORDER BY similarity(descripcion, ${query}) DESC, code ASC
       LIMIT ${limit}
    `);
    return (result.rows as unknown as Cie10Row[]).map((r) => ({
      cie10: r.code,
      descripcion: r.descripcion,
    }));
  }
}
