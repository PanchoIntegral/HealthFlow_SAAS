import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { UserRole } from '@healthflow/shared-types';

export interface RequestContext {
  tenantId: string;
  userId: string;
  rol: UserRole;
}

/**
 * Contexto de la petición autenticada, propagado vía AsyncLocalStorage.
 * Los casos de uso leen de aquí el tenant activo (para RLS) y el usuario
 * (para auditoría) sin tener que pasarlos por cada firma de método.
 */
@Injectable()
export class RequestContextService {
  private readonly als = new AsyncLocalStorage<RequestContext>();

  run<T>(ctx: RequestContext, fn: () => T): T {
    return this.als.run(ctx, fn);
  }

  get(): RequestContext {
    const ctx = this.als.getStore();
    if (!ctx) {
      throw new Error('No hay contexto de petición (¿ruta sin autenticación?)');
    }
    return ctx;
  }
}
