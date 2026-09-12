import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { RecallAttemptResult, RecallChannel, RecallStatus } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import { PatientRecall, type EstadoRecall } from '../domain/recall.entity';
import type {
  CambiosTipoRecall,
  ConfiguracionRecall,
  ContactoPaciente,
  FiltrosWorklist,
  MetricasRecall,
  NuevoIntento,
  NuevoMensajeDeIntento,
  NuevoTipoRecall,
  PaginaWorklist,
  RecallRepository,
  TipoRecall,
} from '../domain/recall.repository';

/**
 * Adaptador Drizzle del puerto de Recall.
 *
 * SQL crudo y no el query builder, por el mismo motivo que `messaging` y
 * `public-booking`: varias consultas usan `FOR UPDATE SKIP LOCKED`, índices
 * parciales y agregaciones que el builder no expresa sin perder legibilidad.
 * Ninguna consulta lleva `WHERE tenant_id`: RLS ya acota cada lectura y cada
 * escritura a la clínica de la transacción.
 */
@Injectable()
export class DrizzleRecallRepository implements RecallRepository {
  // ── Catálogo de tipos ──────────────────────────────────────────
  async listarTipos(tx: Tx, soloActivos = false): Promise<TipoRecall[]> {
    const filas = (
      await tx.execute(sql`
        SELECT * FROM recall_types
         WHERE ${soloActivos ? sql`activo` : sql`true`}
         ORDER BY activo DESC, nombre_normalizado
      `)
    ).rows as unknown as FilaTipo[];
    return filas.map(aTipo);
  }

  async buscarTipo(tx: Tx, id: string): Promise<TipoRecall | null> {
    const fila = (await tx.execute(sql`SELECT * FROM recall_types WHERE id=${id}::uuid`))
      .rows[0] as unknown as FilaTipo | undefined;
    return fila ? aTipo(fila) : null;
  }

  async crearTipo(tx: Tx, input: NuevoTipoRecall): Promise<TipoRecall> {
    const fila = (
      await tx.execute(sql`
        INSERT INTO recall_types
          (nombre, interval_months, booking_service_id, auto_generar,
           days_before_first_contact, max_attempts, attempt_spacing_days)
        VALUES (${input.nombre}, ${input.intervalMonths},
                ${input.bookingServiceId ?? null}::uuid, ${input.autoGenerar ?? false},
                ${input.daysBeforeFirstContact ?? 0}, ${input.maxAttempts ?? 3},
                ${input.attemptSpacingDays ?? 7})
        RETURNING *
      `)
    ).rows[0] as unknown as FilaTipo;
    return aTipo(fila);
  }

  async actualizarTipo(tx: Tx, id: string, c: CambiosTipoRecall): Promise<TipoRecall | null> {
    // `coalesce` con el parámetro a NULL deja la columna como estaba: así un
    // PATCH parcial no necesita construir SQL dinámico ni pisar lo que no envía.
    const fila = (
      await tx.execute(sql`
        UPDATE recall_types SET
          nombre = coalesce(${c.nombre ?? null}, nombre),
          interval_months = coalesce(${c.intervalMonths ?? null}, interval_months),
          booking_service_id = CASE WHEN ${c.bookingServiceId !== undefined}
                                    THEN ${c.bookingServiceId ?? null}::uuid
                                    ELSE booking_service_id END,
          auto_generar = coalesce(${c.autoGenerar ?? null}, auto_generar),
          days_before_first_contact =
            coalesce(${c.daysBeforeFirstContact ?? null}, days_before_first_contact),
          max_attempts = coalesce(${c.maxAttempts ?? null}, max_attempts),
          attempt_spacing_days = coalesce(${c.attemptSpacingDays ?? null}, attempt_spacing_days),
          activo = coalesce(${c.activo ?? null}, activo),
          updated_at = now()
        WHERE id=${id}::uuid
        RETURNING *
      `)
    ).rows[0] as unknown as FilaTipo | undefined;
    return fila ? aTipo(fila) : null;
  }

  // ── Configuración ──────────────────────────────────────────────
  async leerConfiguracion(tx: Tx): Promise<ConfiguracionRecall> {
    const fila = (await tx.execute(sql`SELECT * FROM recall_settings LIMIT 1`)).rows[0] as unknown as
      | { no_show_recall_type_id: string | null; no_show_delay_days: number }
      | undefined;
    // Sin fila = reactivación apagada. La ausencia es el valor seguro: no se
    // persigue a nadie hasta que la clínica lo decida.
    return {
      noShowRecallTypeId: fila?.no_show_recall_type_id ?? null,
      noShowDelayDays: fila?.no_show_delay_days ?? 1,
    };
  }

  async guardarConfiguracion(tx: Tx, input: ConfiguracionRecall): Promise<ConfiguracionRecall> {
    const fila = (
      await tx.execute(sql`
        INSERT INTO recall_settings (no_show_recall_type_id, no_show_delay_days)
        VALUES (${input.noShowRecallTypeId ?? null}::uuid, ${input.noShowDelayDays})
        ON CONFLICT (tenant_id) DO UPDATE SET
          no_show_recall_type_id = EXCLUDED.no_show_recall_type_id,
          no_show_delay_days = EXCLUDED.no_show_delay_days,
          updated_at = now()
        RETURNING no_show_recall_type_id, no_show_delay_days
      `)
    ).rows[0] as unknown as { no_show_recall_type_id: string | null; no_show_delay_days: number };
    return {
      noShowRecallTypeId: fila.no_show_recall_type_id,
      noShowDelayDays: fila.no_show_delay_days,
    };
  }

  // ── Controles ──────────────────────────────────────────────────
  async cargarParaActualizar(tx: Tx, id: string): Promise<EstadoRecall | null> {
    const fila = (
      await tx.execute(sql`
        SELECT r.*, (SELECT count(*)::int FROM recall_attempts a
                      WHERE a.patient_recall_id = r.id AND a.status <> 'cancelled') AS intentos
          FROM patient_recalls r WHERE r.id=${id}::uuid FOR UPDATE OF r
      `)
    ).rows[0] as unknown as FilaRecall | undefined;
    return fila ? aEstado(fila) : null;
  }

  async insertar(tx: Tx, e: EstadoRecall): Promise<boolean> {
    const filas = await tx.execute(sql`
      INSERT INTO patient_recalls
        (id, patient_id, recall_type_id, source, source_entity_id, due_date, status,
         assigned_doctor_id, appointment_id, last_contact_at, next_attempt_at,
         completed_at, dismiss_reason)
      VALUES (${e.id}::uuid, ${e.patientId}::uuid, ${e.recallTypeId}::uuid, ${e.source},
              ${e.sourceEntityId}::uuid, ${e.dueDate}::date, ${e.status},
              ${e.assignedDoctorId}::uuid, ${e.appointmentId}::uuid,
              ${e.lastContactAt?.toISOString() ?? null}::timestamptz,
              ${e.nextAttemptAt?.toISOString() ?? null}::timestamptz,
              ${e.completedAt?.toISOString() ?? null}::timestamptz, ${e.dismissReason})
      -- La especificación repite el predicado del índice parcial
      -- patient_recalls_vivo_idx; sin ella PostgreSQL no sabe cuál usar.
      ON CONFLICT (tenant_id, patient_id, recall_type_id)
        WHERE status IN ('pending','due','contacted','scheduled')
        DO NOTHING
      RETURNING id
    `);
    return filas.rows.length > 0;
  }

  async guardar(tx: Tx, e: EstadoRecall): Promise<void> {
    await tx.execute(sql`
      UPDATE patient_recalls SET
        due_date=${e.dueDate}::date, status=${e.status},
        assigned_doctor_id=${e.assignedDoctorId}::uuid, appointment_id=${e.appointmentId}::uuid,
        last_contact_at=${e.lastContactAt?.toISOString() ?? null}::timestamptz,
        next_attempt_at=${e.nextAttemptAt?.toISOString() ?? null}::timestamptz,
        completed_at=${e.completedAt?.toISOString() ?? null}::timestamptz,
        dismiss_reason=${e.dismissReason}, updated_at=now()
      WHERE id=${e.id}::uuid
    `);
  }

  async buscarVivosCompatibles(
    tx: Tx,
    patientId: string,
    serviceId: string | null,
  ): Promise<EstadoRecall[]> {
    // Sólo asociación EXPLÍCITA: el tipo tiene que declarar con qué servicio
    // público se agenda. Un tipo sin servicio exige vínculo manual — adivinar
    // cerraría el control equivocado y la métrica de conversión mentiría.
    if (!serviceId) return [];
    const filas = (
      await tx.execute(sql`
        SELECT r.*, (SELECT count(*)::int FROM recall_attempts a
                      WHERE a.patient_recall_id = r.id AND a.status <> 'cancelled') AS intentos
          FROM patient_recalls r
          JOIN recall_types t ON t.id = r.recall_type_id
         WHERE r.patient_id=${patientId}::uuid
           AND r.status IN ('pending','due','contacted')
           AND t.booking_service_id=${serviceId}::uuid
         ORDER BY r.due_date, r.id
         FOR UPDATE OF r
      `)
    ).rows as unknown as FilaRecall[];
    return filas.map(aEstado);
  }

  async buscarVivoPorTipo(
    tx: Tx,
    patientId: string,
    recallTypeId: string,
  ): Promise<EstadoRecall | null> {
    const fila = (
      await tx.execute(sql`
        SELECT r.*, (SELECT count(*)::int FROM recall_attempts a
                      WHERE a.patient_recall_id = r.id AND a.status <> 'cancelled') AS intentos
          FROM patient_recalls r
         WHERE r.patient_id=${patientId}::uuid AND r.recall_type_id=${recallTypeId}::uuid
           AND r.status IN ('pending','due','contacted','scheduled')
         LIMIT 1
      `)
    ).rows[0] as unknown as FilaRecall | undefined;
    return fila ? aEstado(fila) : null;
  }

  async buscarPorCita(tx: Tx, appointmentId: string): Promise<EstadoRecall | null> {
    const fila = (
      await tx.execute(sql`
        SELECT r.*, (SELECT count(*)::int FROM recall_attempts a
                      WHERE a.patient_recall_id = r.id AND a.status <> 'cancelled') AS intentos
          FROM patient_recalls r
         WHERE r.appointment_id=${appointmentId}::uuid
           AND r.status IN ('scheduled','completed')
         LIMIT 1
         FOR UPDATE OF r
      `)
    ).rows[0] as unknown as FilaRecall | undefined;
    return fila ? aEstado(fila) : null;
  }

  // ── Intentos ───────────────────────────────────────────────────
  async crearIntento(tx: Tx, input: NuevoIntento): Promise<string> {
    const fila = (
      await tx.execute(sql`
        INSERT INTO recall_attempts
          (patient_recall_id, channel, attempt_number, scheduled_at, created_by, status)
        VALUES (${input.patientRecallId}::uuid, ${input.channel}, ${input.attemptNumber},
                ${input.scheduledAt.toISOString()}::timestamptz, ${input.createdBy}::uuid,
                'pending')
        RETURNING id
      `)
    ).rows[0] as unknown as { id: string };
    return fila.id;
  }

  async encolarMensajeDeIntento(tx: Tx, input: NuevoMensajeDeIntento): Promise<boolean> {
    // ON CONFLICT DO NOTHING sobre `idempotency_key`, que es UNIQUE desde
    // 0035: la exclusión entre dos workers la da el índice, no el código.
    // `appointment_id` va NULL y lo respalda el CHECK de sujeto único de 0049.
    const filas = await tx.execute(sql`
      INSERT INTO outbound_messages
        (recall_attempt_id, patient_id, channel, kind, scheduled_at, status, provider,
         idempotency_key, next_attempt_at)
      SELECT ${input.recallAttemptId}::uuid, ${input.patientId}::uuid, ${input.channel},
             'recall', ${input.scheduledAt.toISOString()}::timestamptz, 'pending',
             ${input.channel === 'whatsapp' ? 'twilio' : 'resend'},
             ${input.idempotencyKey}, ${input.scheduledAt.toISOString()}::timestamptz
       WHERE ${input.channel} <> 'email' OR NOT EXISTS
         (SELECT 1 FROM patients
           WHERE id=${input.patientId}::uuid AND email_suppressed_at IS NOT NULL)
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    `);
    return filas.rows.length > 0;
  }

  async cerrarIntento(
    tx: Tx,
    id: string,
    resultado: RecallAttemptResult,
    nota: string | null,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE recall_attempts
         SET status='closed', result=${resultado}, note=${nota},
             sent_at=coalesce(sent_at, now()), updated_at=now()
       WHERE id=${id}::uuid
    `);
  }

  async cancelarPendientes(tx: Tx, patientRecallId: string): Promise<void> {
    // El mensaje se cancela ANTES que el intento: si la transacción fallara en
    // medio, es preferible un intento vivo sin mensaje (recepción lo ve y lo
    // cierra) que un mensaje en camino cuyo intento ya nadie mira.
    await tx.execute(sql`
      UPDATE outbound_messages SET status='cancelled', updated_at=now()
       WHERE recall_attempt_id IN (
         SELECT id FROM recall_attempts
          WHERE patient_recall_id=${patientRecallId}::uuid AND status='pending'
       ) AND status IN ('pending','failed')
    `);
    await tx.execute(sql`
      UPDATE recall_attempts SET status='cancelled', updated_at=now()
       WHERE patient_recall_id=${patientRecallId}::uuid AND status='pending'
    `);
  }

  async hayIntentoPendiente(tx: Tx, patientRecallId: string): Promise<boolean> {
    const fila = (
      await tx.execute(sql`
        SELECT 1 FROM recall_attempts
         WHERE patient_recall_id=${patientRecallId}::uuid AND status='pending' LIMIT 1
      `)
    ).rows[0];
    return fila !== undefined;
  }

  // ── Consultas ──────────────────────────────────────────────────
  async listarWorklist(tx: Tx, f: FiltrosWorklist): Promise<PaginaWorklist> {
    const limite = Math.min(Math.max(f.limit, 1), 100);
    const cursor = decodificarCursor(f.cursor);
    const filas = (
      await tx.execute(sql`
        SELECT r.id, r.patient_id, p.nombre AS patient_nombre,
               r.recall_type_id, t.nombre AS tipo_nombre, r.due_date, r.status,
               r.assigned_doctor_id, u.nombre AS doctor_nombre,
               r.last_contact_at, r.next_attempt_at,
               (SELECT count(*)::int FROM recall_attempts a
                 WHERE a.patient_recall_id = r.id AND a.status <> 'cancelled') AS intentos,
               p.archivado_en, p.email, p.email_suppressed_at, p.telefono_normalizado,
               p.whatsapp_opt_in_at, p.canal_preferido
          FROM patient_recalls r
          JOIN patients p ON p.id = r.patient_id
          JOIN recall_types t ON t.id = r.recall_type_id
          LEFT JOIN users u ON u.id = r.assigned_doctor_id
         WHERE ${f.status?.length ? sql`r.status = ANY(${f.status})` : sql`true`}
           AND ${f.dueFrom ? sql`r.due_date >= ${f.dueFrom}::date` : sql`true`}
           AND ${f.dueTo ? sql`r.due_date <= ${f.dueTo}::date` : sql`true`}
           AND ${f.doctorId ? sql`r.assigned_doctor_id = ${f.doctorId}::uuid` : sql`true`}
           AND ${f.q ? sql`p.nombre ILIKE ${`%${f.q}%`}` : sql`true`}
           AND ${cursorSql(cursor)}
         ORDER BY r.due_date, r.id
         LIMIT ${limite + 1}
      `)
    ).rows as unknown as FilaWorklistSql[];

    // Se pide uno de más para saber si hay página siguiente sin un COUNT(*)
    // aparte, que sobre un filtro amplio recorrería toda la tabla.
    const hayMas = filas.length > limite;
    const pagina = hayMas ? filas.slice(0, limite) : filas;
    const ultima = pagina[pagina.length - 1];
    return {
      items: pagina.map(aFilaWorklist),
      nextCursor: hayMas && ultima ? codificarCursor(fecha(ultima.due_date), ultima.id) : null,
    };
  }

  async metricas(tx: Tx, desde: string, hasta: string): Promise<MetricasRecall> {
    const fila = (
      await tx.execute(sql`
        SELECT
          (SELECT count(*)::int FROM patient_recalls
            WHERE status='due') AS vencidos,
          -- Controles ÚNICOS con intento en el periodo, no número de mensajes:
          -- contar envíos convertiría un paciente insistido tres veces en tres
          -- pacientes contactados.
          (SELECT count(DISTINCT a.patient_recall_id)::int FROM recall_attempts a
            WHERE a.created_at >= ${desde}::date AND a.created_at < (${hasta}::date + 1)
              AND a.status <> 'cancelled') AS contactados,
          (SELECT count(*)::int FROM patient_recalls r
            WHERE r.status IN ('scheduled','completed')
              AND r.updated_at >= ${desde}::date AND r.updated_at < (${hasta}::date + 1)) AS convertidos,
          (SELECT count(DISTINCT r.patient_id)::int FROM patient_recalls r
            WHERE r.status='completed'
              AND r.completed_at >= ${desde}::date AND r.completed_at < (${hasta}::date + 1)) AS recuperados,
          (SELECT count(*)::int FROM patient_recalls r
            WHERE r.status='exhausted'
              AND r.updated_at >= ${desde}::date AND r.updated_at < (${hasta}::date + 1)) AS agotados,
          (SELECT percentile_cont(0.5) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (r.updated_at - primer.created_at))/86400)
             FROM patient_recalls r
             JOIN LATERAL (SELECT min(a.created_at) AS created_at FROM recall_attempts a
                            WHERE a.patient_recall_id=r.id AND a.status<>'cancelled') primer ON true
            WHERE r.status IN ('scheduled','completed') AND primer.created_at IS NOT NULL
              AND r.updated_at >= ${desde}::date AND r.updated_at < (${hasta}::date + 1)
          ) AS mediana_dias
      `)
    ).rows[0] as unknown as Record<string, number | null>;
    return {
      vencidos: Number(fila.vencidos ?? 0),
      contactados: Number(fila.contactados ?? 0),
      convertidos: Number(fila.convertidos ?? 0),
      recuperados: Number(fila.recuperados ?? 0),
      agotados: Number(fila.agotados ?? 0),
      medianaDiasHastaReserva:
        fila.mediana_dias === null || fila.mediana_dias === undefined
          ? null
          : Math.round(Number(fila.mediana_dias) * 10) / 10,
    };
  }

  async contactoDePaciente(tx: Tx, patientId: string): Promise<ContactoPaciente | null> {
    const fila = (
      await tx.execute(sql`
        SELECT archivado_en, email, email_suppressed_at, telefono_normalizado,
               whatsapp_opt_in_at, canal_preferido
          FROM patients WHERE id=${patientId}::uuid
      `)
    ).rows[0] as unknown as FilaContacto | undefined;
    return fila ? aContacto(fila) : null;
  }

  async zonaHoraria(tx: Tx): Promise<string> {
    const fila = (await tx.execute(sql`SELECT timezone FROM booking_settings LIMIT 1`)).rows[0] as unknown as
      | { timezone: string }
      | undefined;
    return fila?.timezone ?? 'America/Mexico_City';
  }

  async tipoDePartida(tx: Tx, partidaId: string): Promise<string | null> {
    const fila = (
      await tx.execute(sql`SELECT recall_type_id FROM presupuesto_partidas WHERE id=${partidaId}::uuid`)
    ).rows[0] as unknown as { recall_type_id: string | null } | undefined;
    return fila?.recall_type_id ?? null;
  }

  // ── Worker ─────────────────────────────────────────────────────
  async reclamarVencidos(tx: Tx, hoyLocal: string, limite: number): Promise<string[]> {
    const filas = (
      await tx.execute(sql`
        SELECT r.id FROM patient_recalls r
          JOIN recall_types t ON t.id = r.recall_type_id
         WHERE r.status='pending'
           -- La anticipación del tipo adelanta la aparición en la lista.
           AND r.due_date - make_interval(days => t.days_before_first_contact) <= ${hoyLocal}::date
         ORDER BY r.due_date, r.id
         LIMIT ${Math.min(Math.max(limite, 1), 500)}
         FOR UPDATE OF r SKIP LOCKED
      `)
    ).rows as unknown as { id: string }[];
    return filas.map((f) => f.id);
  }

  async reclamarIntentosVencidos(tx: Tx, ahora: Date, limite: number): Promise<string[]> {
    const filas = (
      await tx.execute(sql`
        SELECT r.id FROM patient_recalls r
         WHERE r.status IN ('due','contacted')
           AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= ${ahora.toISOString()}::timestamptz)
           -- Sin intento en vuelo: si ya hay uno pendiente, no toca otro.
           AND NOT EXISTS (SELECT 1 FROM recall_attempts a
                            WHERE a.patient_recall_id = r.id AND a.status='pending')
         ORDER BY r.due_date, r.id
         LIMIT ${Math.min(Math.max(limite, 1), 500)}
         FOR UPDATE OF r SKIP LOCKED
      `)
    ).rows as unknown as { id: string }[];
    return filas.map((f) => f.id);
  }
}

// ── Mapeo ────────────────────────────────────────────────────────
interface FilaTipo {
  id: string;
  nombre: string;
  interval_months: number;
  booking_service_id: string | null;
  activo: boolean;
  auto_generar: boolean;
  days_before_first_contact: number;
  max_attempts: number;
  attempt_spacing_days: number;
}

interface FilaRecall {
  id: string;
  patient_id: string;
  recall_type_id: string;
  source: string;
  source_entity_id: string | null;
  due_date: Date | string;
  status: RecallStatus;
  assigned_doctor_id: string | null;
  appointment_id: string | null;
  last_contact_at: Date | string | null;
  next_attempt_at: Date | string | null;
  completed_at: Date | string | null;
  dismiss_reason: string | null;
  intentos: number;
}

interface FilaContacto {
  archivado_en: Date | string | null;
  email: string | null;
  email_suppressed_at: Date | string | null;
  telefono_normalizado: string | null;
  whatsapp_opt_in_at: Date | string | null;
  canal_preferido: string | null;
}

type FilaWorklistSql = FilaContacto & {
  id: string;
  patient_id: string;
  patient_nombre: string;
  recall_type_id: string;
  tipo_nombre: string;
  due_date: Date | string;
  status: RecallStatus;
  assigned_doctor_id: string | null;
  doctor_nombre: string | null;
  last_contact_at: Date | string | null;
  next_attempt_at: Date | string | null;
  intentos: number;
};

function aTipo(f: FilaTipo): TipoRecall {
  return {
    id: f.id,
    nombre: f.nombre,
    intervalMonths: f.interval_months,
    bookingServiceId: f.booking_service_id,
    activo: f.activo,
    autoGenerar: f.auto_generar,
    daysBeforeFirstContact: f.days_before_first_contact,
    maxAttempts: f.max_attempts,
    attemptSpacingDays: f.attempt_spacing_days,
  };
}

function aEstado(f: FilaRecall): EstadoRecall {
  return {
    id: f.id,
    patientId: f.patient_id,
    recallTypeId: f.recall_type_id,
    source: f.source as EstadoRecall['source'],
    sourceEntityId: f.source_entity_id,
    dueDate: fecha(f.due_date),
    status: f.status,
    assignedDoctorId: f.assigned_doctor_id,
    appointmentId: f.appointment_id,
    lastContactAt: f.last_contact_at ? new Date(f.last_contact_at) : null,
    nextAttemptAt: f.next_attempt_at ? new Date(f.next_attempt_at) : null,
    completedAt: f.completed_at ? new Date(f.completed_at) : null,
    dismissReason: f.dismiss_reason,
    intentos: Number(f.intentos ?? 0),
  };
}

function aContacto(f: FilaContacto): ContactoPaciente {
  return {
    archivado: f.archivado_en !== null,
    email: f.email,
    emailSuprimido: f.email_suppressed_at !== null,
    telefono: f.telefono_normalizado,
    whatsappOptIn: f.whatsapp_opt_in_at !== null,
    canalPreferido: (f.canal_preferido as ContactoPaciente['canalPreferido']) ?? null,
  };
}

function aFilaWorklist(f: FilaWorklistSql) {
  let canal: RecallChannel = 'phone';
  try {
    canal = PatientRecall.elegirCanal(aContacto(f));
  } catch {
    // Archivado o con opt-out: la lista lo muestra como no contactable en vez
    // de reventar la página entera por una ficha.
    canal = 'manual';
  }
  return {
    id: f.id,
    patientId: f.patient_id,
    patientNombre: f.patient_nombre,
    tipoId: f.recall_type_id,
    tipoNombre: f.tipo_nombre,
    dueDate: fecha(f.due_date),
    status: f.status,
    assignedDoctorId: f.assigned_doctor_id,
    assignedDoctorNombre: f.doctor_nombre,
    lastContactAt: f.last_contact_at ? new Date(f.last_contact_at).toISOString() : null,
    nextAttemptAt: f.next_attempt_at ? new Date(f.next_attempt_at).toISOString() : null,
    intentos: Number(f.intentos ?? 0),
    canalDisponible: canal,
  };
}

/** `date` de PostgreSQL llega como Date o string según el driver. */
function fecha(valor: Date | string): string {
  return typeof valor === 'string' ? valor.slice(0, 10) : valor.toISOString().slice(0, 10);
}

// ── Cursor ───────────────────────────────────────────────────────
/**
 * Cursor opaco `(due_date, id)`. Base64url de un par, no un offset: con
 * OFFSET, insertar un control mientras recepción pagina haría que una fila se
 * repita o se salte, y en una lista con acciones masivas eso es un error de
 * operación, no de estética.
 */
function codificarCursor(dueDate: string, id: string): string {
  return Buffer.from(`${dueDate}|${id}`, 'utf8').toString('base64url');
}

function decodificarCursor(cursor: string | null | undefined): { due: string; id: string } | null {
  if (!cursor) return null;
  const crudo = Buffer.from(cursor, 'base64url').toString('utf8');
  const [due, id] = crudo.split('|');
  if (!due || !id || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return null;
  return { due, id };
}

function cursorSql(cursor: { due: string; id: string } | null): SQL {
  if (!cursor) return sql`true`;
  return sql`(r.due_date, r.id) > (${cursor.due}::date, ${cursor.id}::uuid)`;
}
