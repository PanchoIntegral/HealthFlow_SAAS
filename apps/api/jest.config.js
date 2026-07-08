/**
 * Dos proyectos de test separados:
 *  - domain:      lógica de negocio pura, SIN base de datos (rápido, corre siempre).
 *  - integration: toca Postgres real para verificar el aislamiento RLS.
 */
/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      displayName: 'domain',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/**/*.domain.spec.ts'],
    },
    {
      displayName: 'integration',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/**/*.integration.spec.ts'],
    },
  ],
};
