import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  MetodoPago,
  MovimientoCaja,
  MovimientoCajaView,
  TipoMovimientoCaja,
  TurnoCajaResumen,
  TurnoCajaView,
} from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import { TurnoCaja, type TurnoCajaProps } from '../domain/turno-caja.entity';
import type { RangoCortes, TurnoCajaRepository } from '../domain/turno-caja.repository';

/** Tope del histórico de cortes: un turno por día, así que son ~6 meses. */
const MAX_TURNOS = 200;

interface TurnoRow {
  id: string;
  abierta_por: string;
  abierta_por_nombre: string;
  fondo_inicial_centavos: string;
  abierta_en: Date;
  notas_apertura: string | null;
  cerrada_por: string | null;
  cerrada_por_nombre: string | null;
  cerrada_en: Date | null;
  efectivo_contado_centavos: string | null;
  notas_cierre: string | null;
}

interface MovimientoRow {
  id: string;
  turno_id: string;
  tipo: TipoMovimientoCaja;
  concepto: string;
  monto_centavos: string;
  metodo: MetodoPago;
  patient_id: string | null;
  patient_nombre: string | null;
  appointment_id: string | null;
  presupuesto_id: string | null;
  abono_id: string | null;
  referencia: string | null;
  registrado_por: string;
  registrado_por_nombre: string;
  created_at: Date;
  cancelado_en: Date | null;
  cancelado_por: string | null;
  cancelado_por_nombre: string | null;
  motivo_cancelacion: string | null;
}

/**
 * Adaptador Drizzle/Postgres. Corre sobre la transacción con tenant fijado:
 * RLS aísla las lecturas y el DEFAULT current_tenant_id() rellena tenant_id en
 * los inserts, igual que en el resto de los módulos.
 *
 * `bigint` llega como STRING desde node-postgres (para no perder precisión en
 * enteros grandes), por eso cada lectura lo convierte a número. Los centavos
 * caben de sobra en un `number` de JS.
 */
@Injectable()
export class DrizzleTurnoCajaRepository implements TurnoCajaRepository {
  async abrir(tx: Tx, turno: TurnoCaja): Promise<string> {
    const s = turno.toState();
    // Si otro usuario abrió caja en el mismo instante, el índice único parcial
    // `caja_turnos_abierta_uq` revienta aquí y la transacción se revierte:
    // la unicidad no depende de la comprobación previa del caso de uso.
    await tx.execute(sql`
      INSERT INTO caja_turnos (id, abierta_por, fondo_inicial_centavos, abierta_en, notas_apertura)
      VALUES (${s.id}, ${s.abiertaPor}, ${s.fondoInicialCentavos}, ${s.abiertaEn}, ${s.notasApertura})
    `);
    return s.id;
  }

  async findAbierto(tx: Tx): Promise<TurnoCaja | null> {
    const res = await tx.execute(sql`
      SELECT id FROM caja_turnos WHERE cerrada_en IS NULL LIMIT 1
    `);
    const id = (res.rows as unknown as { id: string }[])[0]?.id;
    return id ? this.findById(tx, id) : null;
  }

  async findById(tx: Tx, id: string): Promise<TurnoCaja | null> {
    const row = await this.leerTurno(tx, id);
    if (!row) return null;
    const movimientos = await this.leerMovimientos(tx, [id]);
    return TurnoCaja.fromState(this.aProps(row, movimientos.map(quitarNombres)));
  }

  /**
   * Guarda el agregado. Los movimientos se insertan o actualizan uno por uno
   * (nunca se borran: la cancelación es lógica), a diferencia de las partidas
   * de presupuesto que sí se reescriben — aquí cada fila es un hecho contable
   * con su propia historia de quién lo capturó y cuándo.
   */
  async guardar(tx: Tx, turno: TurnoCaja): Promise<void> {
    const s = turno.toState();
    await tx.execute(sql`
      UPDATE caja_turnos
         SET cerrada_por = ${s.cerradaPor},
             cerrada_en = ${s.cerradaEn},
             efectivo_contado_centavos = ${s.efectivoContadoCentavos},
             notas_cierre = ${s.notasCierre}
       WHERE id = ${s.id}
    `);

    const existentes = new Set(
      (
        (await tx.execute(sql`SELECT id FROM caja_movimientos WHERE turno_id = ${s.id}`))
          .rows as unknown as { id: string }[]
      ).map((r) => r.id),
    );

    for (const m of s.movimientos) {
      if (existentes.has(m.id)) {
        await tx.execute(sql`
          UPDATE caja_movimientos
             SET concepto = ${m.concepto},
                 monto_centavos = ${m.montoCentavos},
                 metodo = ${m.metodo},
                 referencia = ${m.referencia},
                 abono_id = ${m.abonoId},
                 cancelado_en = ${m.canceladoEn},
                 cancelado_por = ${m.canceladoPor},
                 motivo_cancelacion = ${m.motivoCancelacion}
           WHERE id = ${m.id}
        `);
        continue;
      }
      await tx.execute(sql`
        INSERT INTO caja_movimientos
          (id, turno_id, tipo, concepto, monto_centavos, metodo, patient_id,
           appointment_id, presupuesto_id, abono_id, referencia, registrado_por, created_at)
        VALUES
          (${m.id}, ${s.id}, ${m.tipo}, ${m.concepto}, ${m.montoCentavos}, ${m.metodo},
           ${m.patientId}, ${m.appointmentId}, ${m.presupuestoId}, ${m.abonoId},
           ${m.referencia}, ${m.registradoPor}, ${m.createdAt})
      `);
    }
  }

  async vistaDe(tx: Tx, id: string): Promise<TurnoCajaView | null> {
    const row = await this.leerTurno(tx, id);
    if (!row) return null;
    const movimientos = await this.leerMovimientos(tx, [id]);
    const turno = TurnoCaja.fromState(this.aProps(row, movimientos.map(quitarNombres)));
    return { ...this.aResumen(row, turno), movimientos };
  }

  /**
   * Histórico de cortes. Dos consultas (turnos + sus movimientos) y el resumen
   * se calcula en memoria con la MISMA entidad que usa el turno abierto: si el
   * cálculo del efectivo esperado viviera además en SQL, tarde o temprano las
   * dos versiones dirían cosas distintas.
   */
  async listarTurnos(tx: Tx, rango: RangoCortes): Promise<TurnoCajaResumen[]> {
    const condiciones = [
      rango.desde ? sql`t.abierta_en >= ${rango.desde}::date` : null,
      // `< hasta + 1 día` y no `<= hasta`: comparar un timestamptz contra una
      // fecha la interpreta a medianoche y dejaría fuera todo el último día.
      rango.hasta ? sql`t.abierta_en < (${rango.hasta}::date + interval '1 day')` : null,
    ].filter((c): c is NonNullable<typeof c> => c !== null);

    const where =
      condiciones.length > 0 ? sql`WHERE ${sql.join(condiciones, sql` AND `)}` : sql``;

    const res = await tx.execute(sql`
      SELECT t.id, t.abierta_por, t.fondo_inicial_centavos, t.abierta_en, t.notas_apertura,
             t.cerrada_por, t.cerrada_en, t.efectivo_contado_centavos, t.notas_cierre,
             ua.nombre AS abierta_por_nombre, uc.nombre AS cerrada_por_nombre
        FROM caja_turnos t
        JOIN users ua ON ua.id = t.abierta_por
        LEFT JOIN users uc ON uc.id = t.cerrada_por
        ${where}
       ORDER BY t.abierta_en DESC
       LIMIT ${MAX_TURNOS}
    `);

    const rows = res.rows as unknown as TurnoRow[];
    if (rows.length === 0) return [];

    const movimientos = await this.leerMovimientos(
      tx,
      rows.map((r) => r.id),
    );
    const porTurno = new Map<string, MovimientoCaja[]>();
    for (const m of movimientos) {
      const lista = porTurno.get(m.turnoId) ?? [];
      lista.push(quitarNombres(m));
      porTurno.set(m.turnoId, lista);
    }

    return rows.map((row) => {
      const turno = TurnoCaja.fromState(this.aProps(row, porTurno.get(row.id) ?? []));
      return this.aResumen(row, turno);
    });
  }

  // ── helpers ────────────────────────────────────────────────────

  private async leerTurno(tx: Tx, id: string): Promise<TurnoRow | null> {
    const res = await tx.execute(sql`
      SELECT t.id, t.abierta_por, t.fondo_inicial_centavos, t.abierta_en, t.notas_apertura,
             t.cerrada_por, t.cerrada_en, t.efectivo_contado_centavos, t.notas_cierre,
             ua.nombre AS abierta_por_nombre, uc.nombre AS cerrada_por_nombre
        FROM caja_turnos t
        JOIN users ua ON ua.id = t.abierta_por
        LEFT JOIN users uc ON uc.id = t.cerrada_por
       WHERE t.id = ${id}
       LIMIT 1
    `);
    return (res.rows as unknown as TurnoRow[])[0] ?? null;
  }

  private async leerMovimientos(
    tx: Tx,
    turnoIds: string[],
  ): Promise<(MovimientoCajaView & { turnoId: string })[]> {
    if (turnoIds.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT m.id, m.turno_id, m.tipo, m.concepto, m.monto_centavos, m.metodo,
             m.patient_id, m.appointment_id, m.presupuesto_id, m.abono_id, m.referencia,
             m.registrado_por, m.created_at, m.cancelado_en, m.cancelado_por, m.motivo_cancelacion,
             p.nombre AS patient_nombre, ur.nombre AS registrado_por_nombre,
             ucx.nombre AS cancelado_por_nombre
        FROM caja_movimientos m
        JOIN users ur ON ur.id = m.registrado_por
        LEFT JOIN patients p ON p.id = m.patient_id
        LEFT JOIN users ucx ON ucx.id = m.cancelado_por
       WHERE m.turno_id IN (${sql.join(
         turnoIds.map((id) => sql`${id}`),
         sql`, `,
       )})
       ORDER BY m.created_at ASC
    `);

    return (res.rows as unknown as MovimientoRow[]).map((r) => ({
      turnoId: r.turno_id,
      id: r.id,
      tipo: r.tipo,
      concepto: r.concepto,
      montoCentavos: Number(r.monto_centavos),
      metodo: r.metodo,
      patientId: r.patient_id,
      patientNombre: r.patient_nombre,
      appointmentId: r.appointment_id,
      presupuestoId: r.presupuesto_id,
      abonoId: r.abono_id,
      referencia: r.referencia,
      registradoPor: r.registrado_por,
      registradoPorNombre: r.registrado_por_nombre,
      createdAt: new Date(r.created_at).toISOString(),
      canceladoEn: r.cancelado_en ? new Date(r.cancelado_en).toISOString() : null,
      canceladoPor: r.cancelado_por,
      canceladoPorNombre: r.cancelado_por_nombre,
      motivoCancelacion: r.motivo_cancelacion,
    }));
  }

  private aProps(row: TurnoRow, movimientos: MovimientoCaja[]): TurnoCajaProps {
    return {
      id: row.id,
      abiertaPor: row.abierta_por,
      fondoInicialCentavos: Number(row.fondo_inicial_centavos),
      abiertaEn: new Date(row.abierta_en),
      notasApertura: row.notas_apertura,
      cerradaPor: row.cerrada_por,
      cerradaEn: row.cerrada_en ? new Date(row.cerrada_en) : null,
      efectivoContadoCentavos:
        row.efectivo_contado_centavos === null ? null : Number(row.efectivo_contado_centavos),
      notasCierre: row.notas_cierre,
      movimientos,
    };
  }

  private aResumen(row: TurnoRow, turno: TurnoCaja): TurnoCajaResumen {
    return {
      id: row.id,
      abierta: turno.abierta,
      abiertaPor: row.abierta_por,
      abiertaPorNombre: row.abierta_por_nombre,
      abiertaEn: new Date(row.abierta_en).toISOString(),
      notasApertura: row.notas_apertura,
      cerradaPor: row.cerrada_por,
      cerradaPorNombre: row.cerrada_por_nombre,
      cerradaEn: row.cerrada_en ? new Date(row.cerrada_en).toISOString() : null,
      notasCierre: row.notas_cierre,
      resumen: turno.resumen,
    };
  }
}

/** La entidad solo necesita los datos; los nombres son para pintar la vista. */
function quitarNombres(m: MovimientoCajaView & { turnoId?: string }): MovimientoCaja {
  const { patientNombre, registradoPorNombre, canceladoPorNombre, turnoId, ...datos } = m;
  return datos;
}
