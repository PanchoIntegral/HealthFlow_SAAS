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
/**
 * El parser de `sanitize-html` (htmlparser2 12 y sus dependencias) se publica
 * sólo como ESM. Node 22+ lo carga sin problema en producción (`require` de
 * ESM), pero Jest no: esos paquetes se transforman con ts-jest. Se fijan por
 * nombre para no transformar todo node_modules.
 */
const ESM_EN_NODE_MODULES = ['htmlparser2', 'domhandler', 'domutils', 'dom-serializer', 'domelementtype', 'entities'];
const base = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.js$': ['ts-jest', { tsconfig: { allowJs: true }, diagnostics: false }],
  },
  transformIgnorePatterns: [`/node_modules/(?!(\\.pnpm/)?(${ESM_EN_NODE_MODULES.join('|')})[@/])`],
};

/** @type {import('jest').Config} */
module.exports = {
  projects: [
    { displayName: 'domain', testMatch: ['<rootDir>/src/**/*.domain.spec.ts'], ...base },
    { displayName: 'integration', testMatch: ['<rootDir>/test/**/*.integration.spec.ts'], ...base },
  ],
};
