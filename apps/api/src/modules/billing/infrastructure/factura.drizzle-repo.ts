import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../../db/drizzle';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import { ConceptoCfdi, type TratamientoIva } from '../domain/concepto-cfdi.entity';
import { EmisorFiscal } from '../domain/emisor-fiscal.entity';
import { Factura, type FacturaEstatus } from '../domain/factura.entity';
import { FacturaYaEmitidaError } from '../domain/factura.errors';
import type { FacturaRepository } from '../domain/factura.repository';
import type { ReceptorFiscal } from '../domain/receptor-fiscal.entity';
import { Rfc } from '../domain/rfc.value-object';

/** centavos (int del dominio) → "1234.50" (numeric de Postgres). */
const toPesos = (centavos: number): string => (centavos / 100).toFixed(2);
/** "1234.50" (numeric de Postgres) → centavos (int del dominio). */
const toCentavos = (pesos: string): number => Math.round(parseFloat(pesos) * 100);

interface FacturaRow {
  id: string;
  appointment_id: string;
  emisor_id: string;
  receptor_id: string;
  estatus: FacturaEstatus;
  uuid_fiscal: string | null;
  pac_raw_id: string | null;
  subtotal: string;
  iva: string;
  total: string;
  error_code: string | null;
  motivo_cancelacion: string | null;
  timbrada_en: Date | null;
  cancelada_en: Date | null;
}

/**
 * Adaptador Drizzle/Postgres de facturación. Corre sobre la transacción con
 * tenant fijado (RLS) y ADEMÁS filtra por tenant_id en cada query — defensa en
 * profundidad, no quitar el filtro asumiendo que "la RLS ya lo cubre".
 *
 * La conversión centavos ↔ numeric vive centralizada aquí.
 */
@Injectable()
export class DrizzleFacturaRepository implements FacturaRepository {
  constructor(private readonly ctx: RequestContextService) {}

  private get tenantId(): string {
    return this.ctx.get().tenantId;
  }

  async insertPendiente(tx: Tx, factura: Factura, conceptos: ConceptoCfdi[]): Promise<void> {
    const f = factura.toState();
    try {
      await tx.execute(sql`
        INSERT INTO facturas (id, appointment_id, emisor_id, receptor_id, estatus, subtotal, iva, total)
        VALUES (${f.id}, ${f.appointmentId}, ${f.emisorId}, ${f.receptorId}, ${f.estatus},
                ${toPesos(f.subtotalCentavos)}, ${toPesos(f.ivaCentavos)}, ${toPesos(f.totalCentavos)})
      `);
    } catch (err) {
      // El índice único parcial (una factura viva por cita) es el candado real
      // contra el doble submit concurrente: el perdedor llega aquí con 23505.
      if ((err as { code?: string }).code === '23505') {
        throw new FacturaYaEmitidaError();
      }
      throw err;
    }
    // Los conceptos se insertan UNA sola vez; nunca hay update sobre ellos.
    for (const c of conceptos) {
      await tx.execute(sql`
        INSERT INTO conceptos_factura
          (factura_id, clave_prod_serv, clave_unidad, descripcion, cantidad, valor_unitario, importe, tratamiento_iva)
        VALUES (${f.id}, ${c.claveProdServ}, ${c.claveUnidad}, ${c.descripcion},
                ${c.cantidad.toFixed(2)}, ${toPesos(c.valorUnitarioCentavos)},
                ${toPesos(c.importeCentavos)}, ${c.tratamientoIva})
      `);
    }
  }

  async findById(tx: Tx, id: string): Promise<Factura | null> {
    const result = await tx.execute(sql`
      SELECT id, appointment_id, emisor_id, receptor_id, estatus, uuid_fiscal, pac_raw_id,
             subtotal, iva, total, error_code, motivo_cancelacion, timbrada_en, cancelada_en
        FROM facturas
       WHERE id = ${id} AND tenant_id = ${this.tenantId}
       LIMIT 1
    `);
    const row = (result.rows as unknown as FacturaRow[])[0];
    return row ? this.toEntity(row) : null;
  }

  async findActivaByAppointment(tx: Tx, appointmentId: string): Promise<Factura | null> {
    const result = await tx.execute(sql`
      SELECT id, appointment_id, emisor_id, receptor_id, estatus, uuid_fiscal, pac_raw_id,
             subtotal, iva, total, error_code, motivo_cancelacion, timbrada_en, cancelada_en
        FROM facturas
       WHERE appointment_id = ${appointmentId}
         AND tenant_id = ${this.tenantId}
         AND estatus IN ('PENDIENTE','TIMBRADA')
       LIMIT 1
    `);
    const row = (result.rows as unknown as FacturaRow[])[0];
    return row ? this.toEntity(row) : null;
  }

  async findUltimaByAppointment(tx: Tx, appointmentId: string): Promise<Factura | null> {
    const result = await tx.execute(sql`
      SELECT id, appointment_id, emisor_id, receptor_id, estatus, uuid_fiscal, pac_raw_id,
             subtotal, iva, total, error_code, motivo_cancelacion, timbrada_en, cancelada_en
        FROM facturas
       WHERE appointment_id = ${appointmentId} AND tenant_id = ${this.tenantId}
       ORDER BY created_at DESC
       LIMIT 1
    `);
    const row = (result.rows as unknown as FacturaRow[])[0];
    return row ? this.toEntity(row) : null;
  }

  /**
   * Solo campos de la máquina de estados. Deliberadamente NO reescribe
   * conceptos ni montos: una factura timbrada es inmutable ante el SAT.
   */
  async updateEstado(tx: Tx, factura: Factura): Promise<void> {
    const f = factura.toState();
    await tx.execute(sql`
      UPDATE facturas
         SET estatus = ${f.estatus},
             uuid_fiscal = ${f.uuidFiscal},
             pac_raw_id = ${f.pacRawId},
             error_code = ${f.errorCode},
             motivo_cancelacion = ${f.motivoCancelacion},
             timbrada_en = ${f.timbradaEn ? f.timbradaEn.toISOString() : null},
             cancelada_en = ${f.canceladaEn ? f.canceladaEn.toISOString() : null}
       WHERE id = ${f.id} AND tenant_id = ${this.tenantId}
    `);
  }

  async listConceptos(tx: Tx, facturaId: string): Promise<ConceptoCfdi[]> {
    const result = await tx.execute(sql`
      SELECT clave_prod_serv, clave_unidad, descripcion, cantidad, valor_unitario, tratamiento_iva
        FROM conceptos_factura
       WHERE factura_id = ${facturaId} AND tenant_id = ${this.tenantId}
       ORDER BY created_at
    `);
    return (
      result.rows as unknown as {
        clave_prod_serv: string;
        clave_unidad: string;
        descripcion: string;
        cantidad: string;
        valor_unitario: string;
        tratamiento_iva: TratamientoIva;
      }[]
    ).map(
      (row) =>
        new ConceptoCfdi({
          claveProdServ: row.clave_prod_serv,
          claveUnidad: row.clave_unidad,
          descripcion: row.descripcion,
          cantidad: parseFloat(row.cantidad),
          valorUnitarioCentavos: toCentavos(row.valor_unitario),
          tratamientoIva: row.tratamiento_iva,
        }),
    );
  }

  async findEmisorByTenant(tx: Tx): Promise<EmisorFiscal | null> {
    const result = await tx.execute(sql`
      SELECT id, rfc, razon_social, regimen_fiscal, codigo_postal, facturapi_org_id
        FROM emisores_fiscales
       WHERE tenant_id = ${this.tenantId}
       LIMIT 1
    `);
    const row = (
      result.rows as unknown as {
        id: string;
        rfc: string;
        razon_social: string;
        regimen_fiscal: string;
        codigo_postal: string;
        facturapi_org_id: string | null;
      }[]
    )[0];
    if (!row) return null;
    return EmisorFiscal.fromState({
      id: row.id,
      rfc: Rfc.create(row.rfc),
      razonSocial: row.razon_social,
      regimenFiscal: row.regimen_fiscal,
      codigoPostal: row.codigo_postal,
      facturapiOrgId: row.facturapi_org_id,
    });
  }

  async saveReceptor(tx: Tx, receptor: ReceptorFiscal): Promise<string> {
    const result = await tx.execute(sql`
      INSERT INTO receptores_fiscales (patient_id, rfc, razon_social, regimen_fiscal, codigo_postal, uso_cfdi)
      VALUES (${receptor.patientId}, ${receptor.rfc.value}, ${receptor.razonSocial},
              ${receptor.regimenFiscal}, ${receptor.codigoPostal}, ${receptor.usoCfdi})
      RETURNING id
    `);
    return (result.rows[0] as { id: string }).id;
  }

  private toEntity(row: FacturaRow): Factura {
    return Factura.fromState({
      id: row.id,
      appointmentId: row.appointment_id,
      emisorId: row.emisor_id,
      receptorId: row.receptor_id,
      estatus: row.estatus,
      uuidFiscal: row.uuid_fiscal,
      pacRawId: row.pac_raw_id,
      subtotalCentavos: toCentavos(row.subtotal),
      ivaCentavos: toCentavos(row.iva),
      totalCentavos: toCentavos(row.total),
      errorCode: row.error_code,
      motivoCancelacion: row.motivo_cancelacion,
      timbradaEn: row.timbrada_en ? new Date(row.timbrada_en) : null,
      canceladaEn: row.cancelada_en ? new Date(row.cancelada_en) : null,
    });
  }
}
