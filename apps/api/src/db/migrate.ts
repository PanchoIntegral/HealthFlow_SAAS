/**
 * Runner de migraciones SQL. Aplica en orden los archivos de
 * src/db/migrations/*.sql que aún no se hayan aplicado, registrándolos en la
 * tabla `_migrations`. Corre como rol admin. Idempotente.
 * Uso: pnpm --filter @healthflow/api db:migrate
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { loadDotEnv, env } from '../config/env';

loadDotEnv();

const MIGRATIONS_DIR = resolve(__dirname, 'migrations');

async function main() {
  const client = new Client({ connectionString: env.adminDatabaseUrl });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await client.query('SELECT name FROM _migrations')).rows.map((r) => r.name as string),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`• ${file} (ya aplicada)`);
      continue;
    }
    const sqlText = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
    try {
      await client.query('BEGIN');
      await client.query(sqlText);
      await client.query('INSERT INTO _migrations(name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`✓ ${file} aplicada`);
      count++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`✗ ${file} falló — rollback`);
      throw err;
    }
  }

  await client.end();
  console.log(count === 0 ? '✓ Sin migraciones pendientes' : `✓ ${count} migración(es) aplicada(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
