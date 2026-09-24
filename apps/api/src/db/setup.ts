/**
 * Prepara el clúster para desarrollo local o un entorno ya desplegado:
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
  const workerUser = env.workerDbUser;
  const workerPwd = env.workerDbPassword;

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
  const workerExists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [workerUser]);
  if (workerExists.rowCount === 0) {
    await admin.query(`CREATE ROLE ${quoteIdent(workerUser)} LOGIN PASSWORD ${quoteLiteral(workerPwd)} NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    console.log(`✓ Rol restringido de worker "${workerUser}" creado`);
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
  await onTarget.query(`GRANT CONNECT ON DATABASE ${quoteIdent(targetDb)} TO ${quoteIdent(workerUser)}`);
  await onTarget.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdent(workerUser)}`);

  // Las migraciones conceden estos permisos sólo si el rol ya existe. En un
  // entorno que aplicó migraciones ANTES de crear healthflow_worker (p.ej.
  // Railway), este bloque reconcilia el mínimo privilegio sin reejecutarlas.
  const grantFunction = async (signature: string): Promise<void> => {
    const exists = await onTarget.query('SELECT to_regprocedure($1) AS fn', [signature]);
    if (exists.rows[0]?.fn) {
      await onTarget.query(`GRANT EXECUTE ON FUNCTION ${signature} TO ${quoteIdent(workerUser)}`);
    }
  };
  const grantTable = async (privileges: string, table: string): Promise<void> => {
    const exists = await onTarget.query('SELECT to_regclass($1) AS tab', [`public.${table}`]);
    if (exists.rows[0]?.tab) {
      await onTarget.query(`GRANT ${privileges} ON TABLE ${quoteIdent(table)} TO ${quoteIdent(workerUser)}`);
    }
  };

  for (const signature of [
    'claim_outbound_messages(integer)',
    'complete_outbound_message(uuid,text,text,text)',
    'claim_app_events(text,integer)',
    'complete_app_event(uuid,text,boolean,text)',
    'defer_app_event(uuid,text,text,interval)',
    'record_system_audit(uuid,text,uuid,text,jsonb)',
    'cancel_recall_attempt_messages(uuid)',
    'cancel_recall_pending_messages(uuid)',
    'ensure_public_appointment_manage_token(uuid,text)',
  ]) await grantFunction(signature);

  for (const table of ['tenant_feature_flags', 'tenant_module_entitlements', 'recall_types', 'patients', 'appointments', 'tenants', 'booking_settings', 'recall_settings', 'presupuesto_partidas']) {
    await grantTable('SELECT', table);
  }
  for (const table of ['patient_recalls', 'recall_attempts']) {
    await grantTable('SELECT, INSERT, UPDATE', table);
  }
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
