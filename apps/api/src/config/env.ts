import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Carga variables de entorno desde el primer .env encontrado subiendo el árbol
 * de directorios (desde cwd y desde este archivo). Parser propio (sin dotenv)
 * que escribe en process.env — funciona también dentro del sandbox de Jest,
 * a diferencia de process.loadEnvFile. Idempotente. No pisa vars ya presentes.
 */
let loaded = false;
export function loadDotEnv(): void {
  if (loaded) return;
  loaded = true;
  const found = findUp('.env', process.cwd()) ?? findUp('.env', __dirname);
  if (!found) return;
  for (const raw of readFileSync(found, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function findUp(filename: string, from: string): string | undefined {
  let dir = from;
  for (;;) {
    const candidate = resolve(dir, filename);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined; // llegó a la raíz del FS
    dir = parent;
  }
}

// Carga el .env al importar este módulo, ANTES de que cualquier consumidor lea
// `env.*` (p.ej. decoradores evaluados en tiempo de import como JwtModule).
loadDotEnv();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

export const env = {
  get databaseUrl(): string {
    return required('DATABASE_URL');
  },
  get adminDatabaseUrl(): string {
    return required('DB_ADMIN_URL');
  },
  get jwtSecret(): string {
    return required('JWT_SECRET');
  },
  get jwtExpiresIn(): string {
    return process.env.JWT_EXPIRES_IN ?? '1d';
  },
  get apiPort(): number {
    return Number(process.env.API_PORT ?? 3001);
  },
  get webOrigin(): string {
    return process.env.WEB_ORIGIN ?? 'http://localhost:3000';
  },
  get appDbUser(): string {
    return process.env.APP_DB_USER ?? 'healthflow_app';
  },
  get appDbPassword(): string {
    return process.env.APP_DB_PASSWORD ?? 'healthflow_app_pwd';
  },
};
