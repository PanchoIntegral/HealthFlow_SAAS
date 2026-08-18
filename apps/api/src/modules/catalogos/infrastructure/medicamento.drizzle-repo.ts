import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { MedicamentoCatalogo } from '@healthflow/shared-types';
import { DB } from '../../../db/drizzle.module';
import type { Database } from '../../../db/drizzle';
import type { MedicamentoRepository } from '../domain/medicamento.repository';

interface MedicamentoRow {
  clave: string;
  denominacion_generica: string;
  forma_farmaceutica: string;
  presentacion: string;
  via_sugerida: string;
  grupo_terapeutico: string;
  fraccion: number;
}

/**
 * Adaptador Drizzle/Postgres del catálogo de medicamentos. Mismo patrón que
 * `DrizzleCie10Repository`: `pg_trgm` con índices GIN (0027) para que
 * ILIKE '%termino%' no degrade a seq scan, y orden por `similarity()` para que
 * la coincidencia más cercana quede arriba.
 */
@Injectable()
export class DrizzleMedicamentoRepository implements MedicamentoRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async buscar(query: string, limit = 15): Promise<MedicamentoCatalogo[]> {
    const like = `%${query}%`;
    // Se busca también por grupo terapéutico: "antibiótico" es como el médico
    // piensa cuando todavía no eligió la molécula.
    const result = await this.db.execute(sql`
      SELECT clave, denominacion_generica, forma_farmaceutica, presentacion,
             via_sugerida, grupo_terapeutico, fraccion
        FROM medicamentos
       WHERE denominacion_generica ILIKE ${like}
          OR grupo_terapeutico ILIKE ${like}
       ORDER BY similarity(denominacion_generica, ${query}) DESC,
                denominacion_generica ASC,
                presentacion ASC
       LIMIT ${limit}
    `);
    return (result.rows as unknown as MedicamentoRow[]).map((r) => ({
      clave: r.clave,
      denominacionGenerica: r.denominacion_generica,
      formaFarmaceutica: r.forma_farmaceutica,
      presentacion: r.presentacion,
      viaSugerida: r.via_sugerida,
      grupoTerapeutico: r.grupo_terapeutico,
      fraccion: Number(r.fraccion),
    }));
  }
}
