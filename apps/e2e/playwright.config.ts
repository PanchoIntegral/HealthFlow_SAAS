import { defineConfig } from '@playwright/test';
import { API_URL, WEB_URL, API_PORT, WEB_PORT, cargarEnv } from './tests/entorno';

cargarEnv();

/**
 * E2E de la pantalla de consulta. Levanta API y web en puertos PROPIOS para no
 * chocar con un `pnpm dev` abierto (ni con otras apps en el 3000), y los datos
 * los crea cada prueba en una clínica desechable.
 *
 * Requiere Postgres migrado (`pnpm db:setup && pnpm db:migrate`).
 */
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @healthflow/api build && node ../api/dist/main.js',
      port: API_PORT,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: {
        API_PORT: String(API_PORT),
        WEB_ORIGIN: WEB_URL,
      },
    },
    {
      command: `pnpm --filter @healthflow/web exec next dev -p ${WEB_PORT}`,
      url: `${WEB_URL}/login`,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: { NEXT_PUBLIC_API_URL: API_URL },
    },
  ],
});
