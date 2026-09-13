import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const API_PORT = Number(process.env.E2E_API_PORT ?? 3021);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3121);
export const API_URL = `http://localhost:${API_PORT}`;
export const WEB_URL = `http://localhost:${WEB_PORT}`;

/**
 * Lee el `.env` de la raíz sin pisar lo ya definido: el mismo contrato que
 * `loadDotEnv` del API, para que las pruebas usen la misma base y el mismo
 * secreto de JWT que el servidor que levanta Playwright.
 */
export function cargarEnv(): void {
  let dir = __dirname;
  for (;;) {
    const candidato = resolve(dir, '.env');
    if (existsSync(candidato)) {
      for (const linea of readFileSync(candidato, 'utf8').split('\n')) {
        const l = linea.trim();
        if (!l || l.startsWith('#') || !l.includes('=')) continue;
        const i = l.indexOf('=');
        const clave = l.slice(0, i).trim();
        const valor = l.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
        if (process.env[clave] === undefined) process.env[clave] = valor;
      }
      return;
    }
    const padre = dirname(dir);
    if (padre === dir) return;
    dir = padre;
  }
}
