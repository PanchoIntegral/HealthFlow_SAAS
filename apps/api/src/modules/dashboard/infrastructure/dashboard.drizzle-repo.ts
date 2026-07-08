import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { CitasPorDia, DashboardStats } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';

const DIA_INICIAL = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

/**
 * Estadísticas agregadas del dashboard. Todas las consultas corren en la
 * transacción con tenant fijado, por lo que RLS restringe los conteos a la
 * clínica activa automáticamente.
 */
@Injectable()
export class DrizzleDashboardRepository {
  async getStats(tx: Tx): Promise<DashboardStats> {
    const kpis = (
      await tx.execute(sql`
        SELECT
          count(*) FILTER (WHERE inicio_programado::date = current_date) AS citas_hoy,
          count(*) FILTER (WHERE inicio_programado::date = current_date AND estatus = 'finalizada') AS completadas_hoy,
          count(*) FILTER (WHERE inicio_programado::date = current_date AND estatus = 'en_espera') AS en_espera_hoy,
          count(*) FILTER (WHERE date_trunc('month', inicio_programado) = date_trunc('month', current_date)) AS citas_mes,
          count(*) FILTER (WHERE estatus = 'no_asistio' AND date_trunc('month', inicio_programado) = date_trunc('month', current_date)) AS no_shows_mes,
          count(*) FILTER (WHERE estatus IN ('finalizada','no_asistio') AND date_trunc('month', inicio_programado) = date_trunc('month', current_date)) AS cerradas_mes
        FROM appointments
      `)
    ).rows[0] as Record<string, string>;

    const promRow = (
      await tx.execute(sql`
        SELECT avg(extract(epoch FROM (fin_real - inicio_real)) / 60.0) AS prom
          FROM appointments
         WHERE fin_real IS NOT NULL AND inicio_real IS NOT NULL
           AND fin_real >= current_date - interval '30 days'
      `)
    ).rows[0] as { prom: string | null };

    const porDia = (
      await tx.execute(sql`
        SELECT d::date AS fecha, count(a.id) AS total
          FROM generate_series(current_date - interval '6 days', current_date, interval '1 day') d
          LEFT JOIN appointments a ON a.inicio_programado::date = d::date
         GROUP BY d
         ORDER BY d
      `)
    ).rows as unknown as { fecha: Date; total: string }[];

    const cerradasMes = Number(kpis.cerradas_mes);
    const noShowsMes = Number(kpis.no_shows_mes);

    const citasPorDia: CitasPorDia[] = porDia.map((r) => {
      const fecha = new Date(r.fecha);
      return {
        fecha: fecha.toISOString().slice(0, 10),
        label: DIA_INICIAL[fecha.getUTCDay()]!,
        total: Number(r.total),
      };
    });

    return {
      citasHoy: Number(kpis.citas_hoy),
      completadasHoy: Number(kpis.completadas_hoy),
      enEsperaHoy: Number(kpis.en_espera_hoy),
      tiempoPromedioMin: promRow.prom === null ? null : Math.round(Number(promRow.prom)),
      citasDelMes: Number(kpis.citas_mes),
      tasaNoShows: cerradasMes > 0 ? Math.round((noShowsMes / cerradasMes) * 1000) / 10 : 0,
      citasPorDia,
    };
  }
}
