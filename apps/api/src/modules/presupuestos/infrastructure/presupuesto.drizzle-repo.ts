import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  Abono,
  EstatusPartida,
  EstatusPresupuesto,
  MetodoPago,
  PresupuestoPartida,
  PresupuestoView,
  SaldosPorCobrar,
} from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import { presupuestoPartidas } from '../../../db/schema';
import { Presupuesto } from '../domain/presupuesto.entity';
import type { PresupuestoRepository } from '../domain/presupuesto.repository';

interface PresupuestoRow {
  id: string;
  patient_id: string;
  patient_nombre: string;
  doctor_id: string;
  titulo: string;
  estatus: EstatusPresupuesto;
  notas: string | null;
  vigencia_hasta: string | null;
  aceptado_en: Date | null;
  created_at: Date;
}

interface PartidaRow {
  id: string;
  descripcion: string;
  piezas: string[] | null;
  fase: number;
  recall_type_id: string | null;
  cantidad: string;
  valor_unitario_centavos: string;
  estatus: EstatusPartida;
  appointment_id: string | null;
  orden: number;
}

interface AbonoRow {
  id: string;
  monto_centavos: string;
  metodo: MetodoPago;
  fecha: string;
  referencia: string | null;
}

/**
 * Adaptador Drizzle/Postgres. Corre sobre la transacción con tenant fijado:
 * RLS aísla las lecturas y el DEFAULT current_tenant_id() rellena tenant_id en
 * los inserts, igual que en el resto de los módulos.
 *
 * `numeric` y `bigint` llegan como STRING desde node-postgres (para no perder
 * precisión en enteros grandes), por eso cada lectura los convierte a número.
 * Los centavos caben de sobra en un `number` de JS.
 */
@Injectable()
export class DrizzlePresupuestoRepository implements PresupuestoRepository {
  async crear(tx: Tx, presupuesto: Presupuesto): Promise<string> {
    const s = presupuesto.toState();
    await tx.execute(sql`
      INSERT INTO presupuestos (id, patient_id, doctor_id, titulo, estatus, notas, vigencia_hasta)
      VALUES (${s.id}, ${s.patientId}, ${s.doctorId}, ${s.titulo}, ${s.estatus},
              ${s.notas}, ${s.vigenciaHasta})
    `);
    await this.insertarPartidas(tx, s.id, s.partidas);
    return s.id;
  }

  async findById(tx: Tx, id: string): Promise<Presupuesto | null> {
    const res = await tx.execute(sql`
      SELECT p.id, p.patient_id, p.doctor_id, p.titulo, p.estatus, p.notas,
             p.vigencia_hasta, p.aceptado_en, p.created_at, pa.nombre AS patient_nombre
        FROM presupuestos p
        JOIN patients pa ON pa.id = p.patient_id
       WHERE p.id = ${id}
       LIMIT 1
    `);
    const row = (res.rows as unknown as PresupuestoRow[])[0];
    if (!row) return null;

    const [partidas, abonos] = await Promise.all([
      this.leerPartidas(tx, id),
      this.leerAbonos(tx, id),
    ]);

    return Presupuesto.fromState({
      id: row.id,
      patientId: row.patient_id,
      doctorId: row.doctor_id,
      titulo: row.titulo,
      estatus: row.estatus,
      notas: row.notas,
      vigenciaHasta: row.vigencia_hasta,
      aceptadoEn: row.aceptado_en ? new Date(row.aceptado_en) : null,
      partidas,
      abonos,
    });
  }

  /**
   * Guarda el agregado completo. Las partidas se borran y reinsertan: el
   * agregado es pequeño (decenas de filas) y así el estado en base es
   * exactamente el de la entidad, sin diffs a mano que puedan dejar huérfanos.
   * Los abonos solo se agregan, nunca se reescriben — son un registro contable.
   */
  async guardar(tx: Tx, presupuesto: Presupuesto): Promise<void> {
    const s = presupuesto.toState();
    await tx.execute(sql`
      UPDATE presupuestos
         SET titulo = ${s.titulo}, estatus = ${s.estatus}, notas = ${s.notas},
             vigencia_hasta = ${s.vigenciaHasta}, aceptado_en = ${s.aceptadoEn}
       WHERE id = ${s.id}
    `);

    await tx.execute(sql`DELETE FROM presupuesto_partidas WHERE presupuesto_id = ${s.id}`);
    await this.insertarPartidas(tx, s.id, s.partidas);

    const existentes = new Set(
      (
        (await tx.execute(sql`SELECT id FROM presupuesto_abonos WHERE presupuesto_id = ${s.id}`))
          .rows as unknown as { id: string }[]
      ).map((r) => r.id),
    );
    for (const a of s.abonos) {
      if (existentes.has(a.id)) continue;
      await tx.execute(sql`
        INSERT INTO presupuesto_abonos (id, presupuesto_id, monto_centavos, metodo, fecha, referencia)
        VALUES (${a.id}, ${s.id}, ${a.montoCentavos}, ${a.metodo}, ${a.fecha}, ${a.referencia})
      `);
    }
  }

  async vistaDe(tx: Tx, id: string): Promise<PresupuestoView | null> {
    const presupuesto = await this.findById(tx, id);
    if (!presupuesto) return null;
    const res = await tx.execute(sql`
      SELECT p.id, p.patient_id, p.doctor_id, p.titulo, p.estatus, p.notas,
             p.vigencia_hasta, p.aceptado_en, p.created_at, pa.nombre AS patient_nombre
        FROM presupuestos p JOIN patients pa ON pa.id = p.patient_id
       WHERE p.id = ${id} LIMIT 1
    `);
    const row = (res.rows as unknown as PresupuestoRow[])[0]!;
    return this.aVista(presupuesto, row);
  }

  async listarPorPaciente(tx: Tx, patientId: string): Promise<PresupuestoView[]> {
    const res = await tx.execute(sql`
      SELECT p.id FROM presupuestos p
       WHERE p.patient_id = ${patientId}
       ORDER BY p.created_at DESC
    `);
    const ids = (res.rows as unknown as { id: string }[]).map((r) => r.id);
    const vistas: PresupuestoView[] = [];
    for (const id of ids) {
      const v = await this.vistaDe(tx, id);
      if (v) vistas.push(v);
    }
    return vistas;
  }

  /**
   * Todos los presupuestos del consultorio, para el tablero. RLS ya aísla por
   * tenant; aquí solo filtramos por estatus si el usuario eligió alguno.
   */
  async listarTodos(tx: Tx, estatus?: EstatusPresupuesto[]): Promise<PresupuestoView[]> {
    // `sql.join` con un placeholder por valor: interpolar el arreglo entero
    // en el template (`ANY(${estatus})`) lo manda como literal suelto y
    // Postgres responde "malformed array literal", igual que con `piezas`.
    const res = await tx.execute(
      estatus && estatus.length > 0
        ? sql`
            SELECT p.id FROM presupuestos p
             WHERE p.estatus IN (${sql.join(estatus.map((e) => sql`${e}`), sql`, `)})
             ORDER BY p.created_at DESC
          `
        : sql`
            SELECT p.id FROM presupuestos p
             ORDER BY p.created_at DESC
          `,
    );
    const ids = (res.rows as unknown as { id: string }[]).map((r) => r.id);
    const vistas: PresupuestoView[] = [];
    for (const id of ids) {
      const v = await this.vistaDe(tx, id);
      if (v) vistas.push(v);
    }
    return vistas;
  }

  /**
   * Saldos vivos. El cálculo va en SQL y no cargando cada agregado porque es
   * la consulta del tablero de finanzas: traer N presupuestos completos para
   * sumar dos columnas sería absurdo.
   */
  async saldosPorCobrar(tx: Tx): Promise<SaldosPorCobrar> {
    const res = await tx.execute(sql`
      WITH totales AS (
        SELECT p.id, p.patient_id, p.titulo, pa.nombre AS patient_nombre,
               COALESCE((SELECT SUM(ROUND(pp.cantidad * pp.valor_unitario_centavos))
                           FROM presupuesto_partidas pp
                          WHERE pp.presupuesto_id = p.id AND pp.estatus <> 'cancelada'), 0) AS total,
               COALESCE((SELECT SUM(ab.monto_centavos)
                           FROM presupuesto_abonos ab
                          WHERE ab.presupuesto_id = p.id), 0) AS abonado
          FROM presupuestos p
          JOIN patients pa ON pa.id = p.patient_id
         WHERE p.estatus = 'aceptado'
      )
      SELECT id, patient_id, patient_nombre, titulo, (total - abonado) AS saldo
        FROM totales
       WHERE (total - abonado) > 0
       ORDER BY saldo DESC
    `);

    const filas = (
      res.rows as unknown as {
        id: string;
        patient_id: string;
        patient_nombre: string;
        titulo: string;
        saldo: string;
      }[]
    ).map((r) => ({
      id: r.id,
      patientId: r.patient_id,
      patientNombre: r.patient_nombre,
      titulo: r.titulo,
      saldoCentavos: Number(r.saldo),
    }));

    return {
      totalCentavos: filas.reduce((s, f) => s + f.saldoCentavos, 0),
      presupuestos: filas,
    };
  }

  async findPorCitaConPartidasTerminadas(
    tx: Tx,
    appointmentId: string,
  ): Promise<Presupuesto | null> {
    const res = await tx.execute(sql`
      SELECT DISTINCT presupuesto_id FROM presupuesto_partidas
       WHERE appointment_id = ${appointmentId} AND estatus = 'terminado'
       LIMIT 1
    `);
    const id = (res.rows as unknown as { presupuesto_id: string }[])[0]?.presupuesto_id;
    return id ? this.findById(tx, id) : null;
  }

  // ── helpers ────────────────────────────────────────────────────

  /**
   * Inserta con el constructor tipado de Drizzle y NO con `sql` crudo, por la
   * columna `piezas text[]`: interpolar un arreglo de JS en el template lo
   * manda como valor suelto y Postgres responde `malformed array literal`.
   * El builder conoce el tipo de la columna y lo serializa bien.
   */
  private async insertarPartidas(
    tx: Tx,
    presupuestoId: string,
    partidas: PresupuestoPartida[],
  ): Promise<void> {
    if (partidas.length === 0) return;
    await tx.insert(presupuestoPartidas).values(
      partidas.map((p, i) => ({
        id: p.id,
        presupuestoId,
        descripcion: p.descripcion,
        piezas: p.piezas,
        fase: p.fase,
        // `numeric` viaja como string para no perder precisión.
        cantidad: String(p.cantidad),
        valorUnitarioCentavos: p.valorUnitarioCentavos,
        estatus: p.estatus,
        appointmentId: p.appointmentId,
        recallTypeId: p.recallTypeId,
        orden: i,
      })),
    );
  }

  private async leerPartidas(tx: Tx, presupuestoId: string): Promise<PresupuestoPartida[]> {
    const res = await tx.execute(sql`
      SELECT id, descripcion, piezas, fase, cantidad, valor_unitario_centavos,
             estatus, appointment_id, recall_type_id, orden
        FROM presupuesto_partidas
       WHERE presupuesto_id = ${presupuestoId}
       ORDER BY fase ASC, orden ASC
    `);
    return (res.rows as unknown as PartidaRow[]).map((r) => {
      const cantidad = Number(r.cantidad);
      const valorUnitarioCentavos = Number(r.valor_unitario_centavos);
      return {
        id: r.id,
        descripcion: r.descripcion,
        piezas: r.piezas ?? [],
        fase: r.fase,
        cantidad,
        valorUnitarioCentavos,
        estatus: r.estatus,
        appointmentId: r.appointment_id,
        recallTypeId: r.recall_type_id,
        // Se recalcula al leer en vez de guardarse: misma regla que en la
        // entidad, un importe almacenado podría desfasarse de sus factores.
        importeCentavos: Math.round(cantidad * valorUnitarioCentavos),
      };
    });
  }

  private async leerAbonos(tx: Tx, presupuestoId: string): Promise<Abono[]> {
    const res = await tx.execute(sql`
      SELECT id, monto_centavos, metodo, fecha, referencia
        FROM presupuesto_abonos
       WHERE presupuesto_id = ${presupuestoId}
       ORDER BY fecha ASC, created_at ASC
    `);
    return (res.rows as unknown as AbonoRow[]).map((r) => ({
      id: r.id,
      montoCentavos: Number(r.monto_centavos),
      metodo: r.metodo,
      fecha: typeof r.fecha === 'string' ? r.fecha : new Date(r.fecha).toISOString().slice(0, 10),
      referencia: r.referencia,
    }));
  }

  private aVista(presupuesto: Presupuesto, row: PresupuestoRow): PresupuestoView {
    const s = presupuesto.toState();
    return {
      id: s.id,
      patientId: s.patientId,
      patientNombre: row.patient_nombre,
      doctorId: s.doctorId,
      titulo: s.titulo,
      estatus: s.estatus,
      notas: s.notas,
      vigenciaHasta: s.vigenciaHasta,
      aceptadoEn: s.aceptadoEn ? s.aceptadoEn.toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
      partidas: s.partidas,
      abonos: s.abonos,
      totalCentavos: presupuesto.totalCentavos,
      abonadoCentavos: presupuesto.abonadoCentavos,
      saldoCentavos: presupuesto.saldoCentavos,
    };
  }
}
