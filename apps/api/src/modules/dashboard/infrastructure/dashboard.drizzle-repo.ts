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
    // Los KPIs son todos del mes en curso o de hoy, así que la query se acota
    // primero al mes con un rango sargable (usa appointments_tenant_inicio_idx)
    // y los FILTER trabajan ya sobre ese subconjunto. Antes cada FILTER
    // aplicaba un cast por fila sobre la tabla ENTERA del tenant, lo que
    // forzaba un seq scan que crecía con la antigüedad de la cuenta.
    //
    // Los límites se derivan de current_date, que se resuelve en la zona
    // horaria de la sesión — exactamente igual que los ::date y date_trunc que
    // sustituyen, de modo que los números no cambian.
    const kpis = (
      await tx.execute(sql`
        WITH limites AS (
          SELECT date_trunc('month', current_date)::timestamptz            AS mes_inicio,
                 (date_trunc('month', current_date) + interval '1 month')::timestamptz AS mes_fin,
                 current_date::timestamptz                                 AS hoy_inicio,
                 (current_date + 1)::timestamptz                           AS hoy_fin
        )
        SELECT
          count(*) FILTER (WHERE a.inicio_programado >= l.hoy_inicio AND a.inicio_programado < l.hoy_fin) AS citas_hoy,
          count(*) FILTER (WHERE a.inicio_programado >= l.hoy_inicio AND a.inicio_programado < l.hoy_fin AND a.estatus = 'finalizada') AS completadas_hoy,
          count(*) FILTER (WHERE a.inicio_programado >= l.hoy_inicio AND a.inicio_programado < l.hoy_fin AND a.estatus = 'en_espera') AS en_espera_hoy,
          count(*) AS citas_mes,
          count(*) FILTER (WHERE a.estatus = 'no_asistio') AS no_shows_mes,
          count(*) FILTER (WHERE a.estatus IN ('finalizada','no_asistio')) AS cerradas_mes
        FROM appointments a, limites l
        WHERE a.inicio_programado >= l.mes_inicio
          AND a.inicio_programado <  l.mes_fin
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

    // Se agrega PRIMERO por día dentro de la ventana de 7 días y luego se une
    // la serie, en vez de unir la serie contra la tabla entera con un cast en
    // la condición del join (que obligaba a recorrer todas las citas del
    // tenant siete veces). El LEFT JOIN sigue siendo la serie contra el
    // agregado, así que los días sin citas siguen apareciendo con total 0.
    const porDia = (
      await tx.execute(sql`
        WITH ventana AS (
          SELECT (current_date - 6)::timestamptz AS desde,
                 (current_date + 1)::timestamptz AS hasta
        ),
        por_dia AS (
          SELECT a.inicio_programado::date AS fecha, count(*) AS total
            FROM appointments a, ventana v
           WHERE a.inicio_programado >= v.desde
             AND a.inicio_programado <  v.hasta
           GROUP BY 1
        )
        SELECT d::date AS fecha, coalesce(p.total, 0) AS total
          FROM generate_series(current_date - interval '6 days', current_date, interval '1 day') d
          LEFT JOIN por_dia p ON p.fecha = d::date
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
