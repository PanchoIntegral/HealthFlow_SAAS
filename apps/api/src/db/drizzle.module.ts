import { Global, Module, type OnModuleDestroy, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { createAppDb, type Database } from './drizzle';

export const DB = Symbol('DB');
export const DB_POOL = Symbol('DB_POOL');

/**
 * Provee la conexión de aplicación (rol `healthflow_app`, sujeto a RLS) a todo
 * el contenedor de Nest. Global para no reimportarlo en cada módulo.
 */
@Global()
@Module({
  providers: [
    {
      provide: DB_POOL,
      useFactory: () => createAppDb(),
    },
    {
      provide: DB,
      useFactory: (bundle: { db: Database; pool: Pool }) => bundle.db,
      inject: [DB_POOL],
    },
  ],
  exports: [DB],
})
export class DrizzleModule implements OnModuleDestroy {
  constructor(@Inject(DB_POOL) private readonly bundle: { db: Database; pool: Pool }) {}

  async onModuleDestroy(): Promise<void> {
    await this.bundle.pool.end();
  }
}
