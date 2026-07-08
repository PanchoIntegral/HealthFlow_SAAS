import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { schema } from './schema';
import { env } from '../config/env';

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Conexión de APLICACIÓN: rol `healthflow_app` (NO superusuario, NO dueño).
 * Las políticas RLS SÍ aplican aquí. Todo acceso de negocio pasa por acá.
 */
export function createAppDb(): { db: Database; pool: Pool } {
  const pool = new Pool({ connectionString: env.databaseUrl });
  return { db: drizzle(pool, { schema }), pool };
}

/**
 * Conexión de ADMINISTRACIÓN: rol dueño/superusuario. Solo para migraciones
 * y seeds. RLS NO aplica aquí (por eso jamás se usa para servir peticiones).
 */
export function createAdminDb(): { db: Database; pool: Pool } {
  const pool = new Pool({ connectionString: env.adminDatabaseUrl });
  return { db: drizzle(pool, { schema }), pool };
}

/**
 * Ejecuta `fn` dentro de una transacción con el tenant activo fijado para
 * esa transacción (SET LOCAL vía set_config(..., true)). Garantiza que el
 * SET y las queries corran sobre la MISMA conexión del pool.
 */
export async function runInTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`,
    );
    return fn(tx);
  });
}
