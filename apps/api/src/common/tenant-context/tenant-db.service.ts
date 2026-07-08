import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../db/drizzle.module';
import { runInTenant, type Database, type Tx } from '../../db/drizzle';
import { RequestContextService } from './request-context';

/**
 * Punto único de acceso a datos para los casos de uso. Abre una transacción
 * con el tenant activo (de la petición) fijado para RLS, y ejecuta el trabajo
 * dentro de ella. Imposible olvidarse de setear el tenant: es automático.
 */
@Injectable()
export class TenantDbService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly ctx: RequestContextService,
  ) {}

  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const { tenantId } = this.ctx.get();
    return runInTenant(this.db, tenantId, fn);
  }
}
