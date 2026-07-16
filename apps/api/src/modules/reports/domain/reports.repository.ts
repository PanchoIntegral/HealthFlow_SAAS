import type { ReportsStats } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';

/** Puerto del repositorio de reportes (solo lectura, RLS-scoped). */
export interface ReportsRepository {
  getStats(tx: Tx): Promise<ReportsStats>;
}

export const REPORTS_REPOSITORY = Symbol('REPORTS_REPOSITORY');
