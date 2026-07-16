import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  DiagnosticoFrecuente,
  ProductividadMedico,
  ReportsStats,
  TendenciaMensual,
} from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';

const MESES = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
];

/**
 * Reportes agregados. Todas las consultas corren en la transacción con tenant
 * fijado (RLS), por lo que los conteos quedan automáticamente acotados a la
 * clínica activa.
 */
@Injectable()
export class DrizzleReportsRepository {
  async getStats(tx: Tx): Promise<ReportsStats> {
    const diagnosticosRows = (
      await tx.execute(sql`
        SELECT d->>'cie10' AS cie10, d->>'descripcion' AS descripcion, count(*)::int AS total
          FROM clinical_notes cn,
               jsonb_array_elements(cn.contenido_nom004->'diagnosticos') AS d
         WHERE cn.estatus = 'cerrada'
         GROUP BY d->>'cie10', d->>'descripcion'
         ORDER BY count(*) DESC
         LIMIT 8
      `)
    ).rows as unknown as DiagnosticoFrecuente[];

    const productividadRows = (
      await tx.execute(sql`
        SELECT a.doctor_id,
               u.nombre AS doctor_nombre,
               count(*)::int AS consultas,
               avg(extract(epoch FROM (a.fin_real - a.inicio_real)) / 60.0) AS tiempo_promedio_min
          FROM appointments a
          JOIN users u ON u.id = a.doctor_id
         WHERE a.estatus = 'finalizada'
           AND a.fin_real IS NOT NULL AND a.inicio_real IS NOT NULL
           AND a.fin_real >= current_date - interval '90 days'
         GROUP BY a.doctor_id, u.nombre
         ORDER BY consultas DESC
      `)
    ).rows as unknown as {
      doctor_id: string;
      doctor_nombre: string;
      consultas: number;
      tiempo_promedio_min: string | null;
    }[];

    const tendenciaRows = (
      await tx.execute(sql`
        SELECT to_char(d, 'YYYY-MM') AS mes, count(a.id)::int AS total
          FROM generate_series(
                 date_trunc('month', current_date) - interval '5 months',
                 date_trunc('month', current_date),
                 interval '1 month'
               ) d
          LEFT JOIN appointments a ON date_trunc('month', a.inicio_programado) = d
         GROUP BY d
         ORDER BY d
      `)
    ).rows as unknown as { mes: string; total: number }[];

    return {
      diagnosticosFrecuentes: diagnosticosRows.map((r) => ({
        cie10: r.cie10,
        descripcion: r.descripcion,
        total: Number(r.total),
      })),
      productividadMedicos: productividadRows.map(
        (r): ProductividadMedico => ({
          doctorId: r.doctor_id,
          doctorNombre: r.doctor_nombre,
          consultas: Number(r.consultas),
          tiempoPromedioMin: r.tiempo_promedio_min === null ? null : Math.round(Number(r.tiempo_promedio_min)),
        }),
      ),
      tendenciaMensual: tendenciaRows.map(
        (r): TendenciaMensual => ({
          mes: r.mes,
          label: mesLabel(r.mes),
          total: Number(r.total),
        }),
      ),
    };
  }
}

function mesLabel(yyyyMm: string): string {
  const [year, month] = yyyyMm.split('-');
  return `${MESES[Number(month) - 1]} ${year}`;
}
