/**
 * Prepara el clúster para desarrollo local:
 *   1. crea la base de datos `healthflow` si no existe,
 *   2. crea el rol de aplicación `healthflow_app` (NO superusuario) si no existe.
 *
 * Corre como el rol admin (superusuario). Idempotente.
 * Uso: pnpm --filter @healthflow/api db:setup
 */
import { Client } from 'pg';
import { loadDotEnv, env } from '../config/env';

loadDotEnv();

function dbNameFromUrl(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

function serverUrl(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

async function main() {
  const targetDb = dbNameFromUrl(env.adminDatabaseUrl);
  const appUser = env.appDbUser;
  const appPwd = env.appDbPassword;

  // Conectar a la db 'postgres' para poder crear la db objetivo.
  const admin = new Client({ connectionString: serverUrl(env.adminDatabaseUrl, 'postgres') });
  await admin.connect();

  const dbExists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [targetDb]);
  if (dbExists.rowCount === 0) {
    await admin.query(`CREATE DATABASE ${quoteIdent(targetDb)}`);
    console.log(`✓ Base de datos "${targetDb}" creada`);
  } else {
    console.log(`• Base de datos "${targetDb}" ya existe`);
  }

  const roleExists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [appUser]);
  if (roleExists.rowCount === 0) {
    await admin.query(
      `CREATE ROLE ${quoteIdent(appUser)} LOGIN PASSWORD ${quoteLiteral(appPwd)} NOSUPERUSER NOCREATEDB NOCREATEROLE`,
    );
    console.log(`✓ Rol de aplicación "${appUser}" creado (NO superusuario)`);
  } else {
    console.log(`• Rol "${appUser}" ya existe`);
  }
  await admin.end();

  // Conectar a la db objetivo para permitir conexión del rol de app.
  const onTarget = new Client({ connectionString: serverUrl(env.adminDatabaseUrl, targetDb) });
  await onTarget.connect();
  await onTarget.query(`GRANT CONNECT ON DATABASE ${quoteIdent(targetDb)} TO ${quoteIdent(appUser)}`);
  await onTarget.end();

  console.log('✓ Setup completo. Siguiente: pnpm db:migrate');
}

function quoteIdent(id: string): string {
  return '"' + id.replace(/"/g, '""') + '"';
}
function quoteLiteral(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

main().catch((err) => {
  console.error('✗ setup falló:', err);
  process.exit(1);
});
