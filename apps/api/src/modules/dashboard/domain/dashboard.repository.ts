import type { DashboardStats } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';

/** Puerto del repositorio de estadísticas del dashboard (solo lectura, RLS-scoped). */
export interface DashboardRepository {
  getStats(tx: Tx): Promise<DashboardStats>;
}

export const DASHBOARD_REPOSITORY = Symbol('DASHBOARD_REPOSITORY');
