/**
 * Dos proyectos de test separados:
 *  - domain:      lógica de negocio pura, SIN base de datos (rápido, corre siempre).
 *  - integration: toca Postgres real para verificar el aislamiento RLS.
 *
 * `pnpm test` corre con --runInBand (ver package.json). No es una manía de
 * rendimiento: las pruebas de integración comparten una sola base y varias
 * cuentan filas o reclaman trabajos con SKIP LOCKED, así que en paralelo se
 * pisan entre ellas y fallan de forma intermitente. En serie las dos suites
 * juntas tardan ~25 s, que es un precio razonable por un verde confiable.
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
