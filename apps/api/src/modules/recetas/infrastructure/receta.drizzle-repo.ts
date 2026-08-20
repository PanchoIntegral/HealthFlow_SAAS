import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  Alergia,
  CancelacionReceta,
  RecetaContent,
  RecetaDetalle,
  RecetaView,
} from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import type {
  ContextoEmision,
  CrearRecetaInput,
  RecetaRepository,
} from '../domain/receta.repository';

interface RecetaRow {
  id: string;
  patient_id: string;
  appointment_id: string | null;
  doctor_id: string;
  folio: string;
  contenido: RecetaContent;
  created_at: Date;
  cancelacion_motivo: string | null;
  cancelacion_fecha: Date | null;
  cancelacion_por_nombre: string | null;
}

/**
 * Adaptador Drizzle/Postgres del puerto RecetaRepository. Corre siempre sobre
 * la transacción con tenant fijado: RLS aísla las lecturas y el DEFAULT
 * current_tenant_id() rellena tenant_id en los inserts.
 *
 * No hay método de actualización porque la base no concede UPDATE sobre
 * `recetas` (ver 0028): la ausencia aquí solo refleja lo que ya es imposible.
 */
@Injectable()
export class DrizzleRecetaRepository implements RecetaRepository {
  async cargarContextoEmision(
    tx: Tx,
    patientId: string,
    doctorId: string,
  ): Promise<ContextoEmision | null> {
    // Una sola consulta: el médico, su clínica y el paciente. El CROSS JOIN
    // contra `tenants` es seguro porque RLS deja exactamente una fila visible.
    const result = await tx.execute(sql`
      SELECT u.nombre              AS medico_nombre,
             u.cedula_profesional,
             u.cedula_especialidad,
             u.especialidad,
             u.institucion_titulo,
             t.nombre_clinica,
             t.direccion           AS direccion_clinica,
             t.telefono            AS telefono_clinica,
             t.logo_storage_key,
             t.leyenda_pie,
             p.nombre              AS paciente_nombre,
             p.fecha_nacimiento    AS paciente_fecha_nacimiento,
             p.sexo                AS paciente_sexo,
             p.alergias            AS paciente_alergias
        FROM users u
        JOIN tenants t ON t.id = u.tenant_id
        CROSS JOIN patients p
       WHERE u.id = ${doctorId} AND p.id = ${patientId}
       LIMIT 1
    `);
    const row = (
      result.rows as unknown as {
        medico_nombre: string;
        cedula_profesional: string | null;
        cedula_especialidad: string | null;
        especialidad: string | null;
        institucion_titulo: string | null;
        nombre_clinica: string;
        direccion_clinica: string | null;
        telefono_clinica: string | null;
        logo_storage_key: string | null;
        leyenda_pie: string | null;
        paciente_nombre: string;
        paciente_fecha_nacimiento: string;
        paciente_sexo: ContextoEmision['pacienteSexo'];
        paciente_alergias: Alergia[] | null;
      }[]
    )[0];
    if (!row) return null;

    return {
      medicoNombre: row.medico_nombre,
      cedulaProfesional: row.cedula_profesional,
      cedulaEspecialidad: row.cedula_especialidad,
      especialidad: row.especialidad,
      institucionTitulo: row.institucion_titulo,
      nombreClinica: row.nombre_clinica,
      direccionClinica: row.direccion_clinica,
      telefonoClinica: row.telefono_clinica,
      logoStorageKey: row.logo_storage_key,
      leyendaPie: row.leyenda_pie,
      pacienteNombre: row.paciente_nombre,
      pacienteFechaNacimiento: String(row.paciente_fecha_nacimiento),
      pacienteSexo: row.paciente_sexo,
      pacienteAlergias: (row.paciente_alergias ?? []).map((a) => a.sustancia),
    };
  }

  /**
   * `medicamentos` es una tabla global sin RLS (0027), pero se consulta con la
   * misma `Tx` que el resto del caso de uso para no abrir una segunda conexión
   * a mitad de una transacción.
   */
  async fraccionesPorClave(tx: Tx, claves: string[]): Promise<Map<string, number>> {
    if (claves.length === 0) return new Map();
    const result = await tx.execute(sql`
      SELECT clave, fraccion FROM medicamentos
       WHERE clave IN (${sql.join(claves.map((c) => sql`${c}`), sql`, `)})
    `);
    return new Map(
      (result.rows as unknown as { clave: string; fraccion: number }[]).map((r) => [
        r.clave,
        Number(r.fraccion),
      ]),
    );
  }

  /**
   * Upsert atómico del contador. El ON CONFLICT DO UPDATE toma el lock de la
   * fila, así que dos emisiones simultáneas de la misma clínica se serializan
   * y la segunda recibe el número siguiente — sin reintentos y sin la carrera
   * que tendría un `MAX(folio_numero) + 1`.
   *
   * `tenant_id` no se nombra: lo pone el DEFAULT current_tenant_id().
   */
  async siguienteFolio(tx: Tx, serie: string, anio: number): Promise<number> {
    const result = await tx.execute(sql`
      INSERT INTO folio_contadores (serie, anio, ultimo)
      VALUES (${serie}, ${anio}, 1)
      ON CONFLICT (tenant_id, serie, anio)
      DO UPDATE SET ultimo = folio_contadores.ultimo + 1, updated_at = now()
      RETURNING ultimo
    `);
    return Number((result.rows[0] as { ultimo: number }).ultimo);
  }

  async crear(
    tx: Tx,
    input: CrearRecetaInput,
    folio: string,
    anio: number,
    numero: number,
  ): Promise<RecetaView> {
    const result = await tx.execute(sql`
      INSERT INTO recetas (patient_id, doctor_id, appointment_id, folio, folio_anio, folio_numero, contenido)
      VALUES (${input.patientId}, ${input.doctorId}, ${input.appointmentId},
              ${folio}, ${anio}, ${numero}, ${JSON.stringify(input.receta.contenido)}::jsonb)
      RETURNING id, created_at
    `);
    // El INSERT ... RETURNING siempre trae una fila o lanza; el non-null es
    // para el compilador, no una suposición sobre la base.
    const row = (result.rows as unknown as { id: string; created_at: Date }[])[0]!;
    return {
      id: row.id,
      patientId: input.patientId,
      appointmentId: input.appointmentId,
      doctorId: input.doctorId,
      folio,
      contenido: input.receta.contenido,
      cancelacion: null,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async listarPorPaciente(tx: Tx, patientId: string): Promise<RecetaView[]> {
    const result = await tx.execute(sql`
      SELECT r.id, r.patient_id, r.appointment_id, r.doctor_id, r.folio, r.contenido, r.created_at,
             c.motivo     AS cancelacion_motivo,
             c.created_at AS cancelacion_fecha,
             cu.nombre    AS cancelacion_por_nombre
        FROM recetas r
        LEFT JOIN recetas_cancelaciones c ON c.receta_id = r.id
        LEFT JOIN users cu ON cu.id = c.cancelado_por
       WHERE r.patient_id = ${patientId}
       ORDER BY r.created_at DESC
    `);
    return (result.rows as unknown as RecetaRow[]).map(toView);
  }

  async findDetalleById(tx: Tx, id: string): Promise<RecetaDetalle | null> {
    const result = await tx.execute(sql`
      SELECT r.id, r.patient_id, r.appointment_id, r.doctor_id, r.folio, r.contenido, r.created_at,
             p.nombre     AS patient_nombre,
             c.motivo     AS cancelacion_motivo,
             c.created_at AS cancelacion_fecha,
             cu.nombre    AS cancelacion_por_nombre
        FROM recetas r
        JOIN patients p ON p.id = r.patient_id
        LEFT JOIN recetas_cancelaciones c ON c.receta_id = r.id
        LEFT JOIN users cu ON cu.id = c.cancelado_por
       WHERE r.id = ${id}
       LIMIT 1
    `);
    const row = (result.rows as unknown as (RecetaRow & { patient_nombre: string })[])[0];
    if (!row) return null;
    return { ...toView(row), patientNombre: row.patient_nombre };
  }

  async existe(tx: Tx, id: string): Promise<boolean> {
    const result = await tx.execute(sql`SELECT 1 FROM recetas WHERE id = ${id} LIMIT 1`);
    return result.rows.length > 0;
  }

  async estaCancelada(tx: Tx, id: string): Promise<boolean> {
    const result = await tx.execute(
      sql`SELECT 1 FROM recetas_cancelaciones WHERE receta_id = ${id} LIMIT 1`,
    );
    return result.rows.length > 0;
  }

  async cancelar(tx: Tx, id: string, canceladoPor: string, motivo: string): Promise<void> {
    await tx.execute(sql`
      INSERT INTO recetas_cancelaciones (receta_id, cancelado_por, motivo)
      VALUES (${id}, ${canceladoPor}, ${motivo})
    `);
  }
}

function toView(row: RecetaRow): RecetaView {
  // El LEFT JOIN trae las tres columnas en NULL cuando no hay cancelación; se
  // exige `motivo` (NOT NULL en la tabla) para decidir, no la fecha.
  const cancelacion: CancelacionReceta | null = row.cancelacion_motivo
    ? {
        motivo: row.cancelacion_motivo,
        canceladoPorNombre: row.cancelacion_por_nombre ?? '',
        fecha: new Date(row.cancelacion_fecha as Date).toISOString(),
      }
    : null;

  return {
    id: row.id,
    patientId: row.patient_id,
    appointmentId: row.appointment_id,
    doctorId: row.doctor_id,
    folio: row.folio,
    contenido: row.contenido,
    cancelacion,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
