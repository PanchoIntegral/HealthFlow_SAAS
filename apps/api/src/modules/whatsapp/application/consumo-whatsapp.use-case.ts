import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { WhatsappConsumoMes } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';

/** Cuántos meses hacia atrás se muestran. Un año da para ver la estacionalidad. */
const MESES = 12;

interface FilaMes {
  mes: string;
  enviados: number;
  entregados: number;
  leidos: number;
  fallidos: number;
  facturables: number;
}

/**
 * Cuántos mensajes mandó la clínica cada mes, que es lo que determina su
 * factura de WhatsApp.
 *
 * Existe porque el costo no es despreciable y no tiene cupo gratis: a ~$0.0085
 * USD por mensaje de utilidad en México, una clínica con 400 citas al mes gasta
 * unos 3.4 dólares solo en recordatorios — poco, hasta que se multiplica por
 * las clínicas de la plataforma y hay que decidir si se absorbe o se repercute.
 *
 * `facturables` cuenta los mensajes que llegaron a salir. Los 'pendiente',
 * 'enviando' y 'fallido' no los cobra Meta, así que no se cuentan: contarlos
 * daría una factura estimada más alta que la real y la cifra dejaría de
 * servir para conciliar.
 */
@Injectable()
export class ConsumoWhatsappUseCase {
  constructor(private readonly tenantDb: TenantDbService) {}

  async execute(): Promise<WhatsappConsumoMes[]> {
    return this.tenantDb.run(async (tx) => {
      const result = await tx.execute(sql`
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM')          AS mes,
               count(*) FILTER (WHERE estado = 'enviado')::int              AS enviados,
               count(*) FILTER (WHERE estado = 'entregado')::int            AS entregados,
               count(*) FILTER (WHERE estado = 'leido')::int                AS leidos,
               count(*) FILTER (WHERE estado = 'fallido')::int              AS fallidos,
               count(*) FILTER (
                 WHERE estado IN ('enviado', 'entregado', 'leido')
               )::int                                                      AS facturables
          FROM whatsapp_outbox
         WHERE created_at >= date_trunc('month', now()) - make_interval(months => ${MESES - 1})
         GROUP BY 1
         ORDER BY 1 DESC
      `);
      return result.rows as unknown as WhatsappConsumoMes[];
    });
  }
}
