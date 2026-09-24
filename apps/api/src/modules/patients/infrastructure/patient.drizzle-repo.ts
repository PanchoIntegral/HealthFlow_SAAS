import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ANTECEDENTES_VACIOS,
  type ActividadClinicaPaciente,
  type Alergia,
  type AntecedentesPaciente,
  type HistorialPaciente,
  type PatientSummary,
  type SexoPaciente,
  type BookingChannel,
  type UpdateHistorialRequest,
} from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import { Patient } from '../domain/patient.entity';
import type { PatientCursor, PatientRepository } from '../domain/patient.repository';

interface PatientRow {
  id: string;
  nombre: string;
  edad: number;
  sexo: SexoPaciente | null;
  curp: string | null;
  telefono: string | null;
}

/**
 * Predicado keyset: "estrictamente después de `desde`" en el orden (nombre, id).
 * Se escribe como comparación de tuplas —y no como `nombre > x OR (nombre = x
 * AND id > y)`— porque así Postgres puede recorrer el índice compuesto
 * directamente desde esa posición.
 */
function despuesDe(desde: PatientCursor | null) {
  return desde
    ? sql`AND (nombre, id) > (${desde.nombre}, ${desde.id}::uuid)`
    : sql``;
}

/**
 * Adaptador Drizzle/Postgres del puerto PatientRepository. Corre sobre la
 * transacción con tenant fijado: RLS aísla las lecturas y el DEFAULT
 * current_tenant_id() rellena tenant_id en el insert.
 */
@Injectable()
export class DrizzlePatientRepository implements PatientRepository {
  async create(tx: Tx, patient: Patient): Promise<string> {
    const p = patient.toProps();
    // tenant_id se autocompleta por DEFAULT current_tenant_id() (ver 0003).
    const result = await tx.execute(sql`
      INSERT INTO patients (nombre, fecha_nacimiento, sexo, curp, telefono, email, canal_preferido)
      VALUES (${p.nombre}, ${p.fechaNacimiento}, ${p.sexo}, ${p.curp}, ${p.telefono}, ${p.email}, ${p.canalPreferido})
      RETURNING id
    `);
    return (result.rows[0] as { id: string }).id;
  }

  async existsByCurp(tx: Tx, curp: string): Promise<boolean> {
    const result = await tx.execute(
      sql`SELECT 1 FROM patients WHERE curp = ${curp} LIMIT 1`,
    );
    return result.rows.length > 0;
  }

  async contarTodos(tx: Tx): Promise<number> {
    // Los archivados NO consumen cupo del plan, mismo criterio que
    // `users.activo` (0018): dar de baja libera el lugar aunque el registro se
    // conserve. Cobrar por un paciente que ya no se atiende, y que la clínica
    // solo guarda porque la NOM-004 la obliga, sería cobrar por archivo muerto.
    const result = await tx.execute(
      sql`SELECT count(*)::int AS total FROM patients WHERE archivado_en IS NULL`,
    );
    return (result.rows as unknown as { total: number }[])[0]?.total ?? 0;
  }

  async contarCoincidencias(tx: Tx, query: string): Promise<number> {
    const like = `${query.toLowerCase()}%`;
    const result = await tx.execute(sql`
      SELECT count(*)::int AS total
        FROM (
          SELECT id FROM patients
           WHERE lower(nombre) LIKE ${like} AND archivado_en IS NULL
          UNION
          SELECT id FROM patients
           WHERE lower(curp) LIKE ${like} AND archivado_en IS NULL
        ) coincidencias
    `);
    return Number((result.rows[0] as { total: number }).total);
  }

  async search(
    tx: Tx,
    query: string,
    limit: number,
    desde: PatientCursor | null,
  ): Promise<PatientSummary[]> {
    const like = `${query.toLowerCase()}%`;
    const corte = despuesDe(desde);
    // Dos ramas UNION en vez de un OR: con `A LIKE … OR B LIKE …` el
    // planificador casi nunca usa índice (tendría que combinar dos índices
    // distintos sobre la misma tabla) y acaba en seq scan. Separadas, cada
    // rama puede atacar su propio índice por prefijo.
    //
    // UNION y no UNION ALL: un paciente cuyo nombre y CURP empiecen igual
    // aparecería dos veces. El LIMIT interno de cada rama acota el trabajo;
    // el externo devuelve el mismo tope de siempre. Esto es un autocompletado
    // por prefijo — mismo criterio de coincidencia que antes.
    const result = await tx.execute(sql`
      SELECT id, nombre, edad, sexo, curp, telefono
        FROM (
          (SELECT id,
                  nombre,
                  date_part('year', age(fecha_nacimiento))::int AS edad,
                  sexo,
                  curp,
                  telefono
             FROM patients
            WHERE lower(nombre) LIKE ${like} AND archivado_en IS NULL ${corte}
            ORDER BY nombre ASC, id ASC
            LIMIT ${limit})
          UNION
          (SELECT id,
                  nombre,
                  date_part('year', age(fecha_nacimiento))::int AS edad,
                  sexo,
                  curp,
                  telefono
             FROM patients
            WHERE lower(curp) LIKE ${like} AND archivado_en IS NULL ${corte}
            ORDER BY nombre ASC, id ASC
            LIMIT ${limit})
        ) coincidencias
       ORDER BY nombre ASC, id ASC
       LIMIT ${limit}
    `);
    return (result.rows as unknown as PatientRow[]).map((r) => ({
      id: r.id,
      nombre: r.nombre,
      edad: Number(r.edad),
      sexo: r.sexo,
      curp: r.curp,
      telefono: r.telefono,
    }));
  }

  async list(tx: Tx, limit: number, desde: PatientCursor | null): Promise<PatientSummary[]> {
    const result = await tx.execute(sql`
      SELECT id,
             nombre,
             date_part('year', age(fecha_nacimiento))::int AS edad,
             sexo,
             curp,
             telefono
        FROM patients
       WHERE archivado_en IS NULL ${despuesDe(desde)}
       ORDER BY nombre ASC, id ASC
       LIMIT ${limit}
    `);
    return (result.rows as unknown as PatientRow[]).map((r) => ({
      id: r.id,
      nombre: r.nombre,
      edad: Number(r.edad),
      sexo: r.sexo,
      curp: r.curp,
      telefono: r.telefono,
    }));
  }

  async updateHistorial(
    tx: Tx,
    patientId: string,
    input: UpdateHistorialRequest,
  ): Promise<HistorialPaciente | null> {
    // Reemplazo completo, no merge: la pantalla envía siempre el historial
    // entero, y un merge parcial haría imposible BORRAR una alergia que se
    // capturó por error — justo la operación que más importa que funcione.
    // `sexo` es la excepción al reemplazo completo: es opcional en el request
    // y `undefined` significa "no lo estoy editando". COALESCE con un
    // parámetro NULL conserva el valor guardado, que es justo lo que necesita
    // el modal de receta cuando captura ÚNICAMENTE el sexo faltante sin
    // reenviar alergias ni antecedentes.
    const sexo = input.sexo === undefined ? null : input.sexo;
    const result = await tx.execute(sql`
      UPDATE patients
         SET sin_alergias_conocidas = ${input.sinAlergiasConocidas},
             alergias      = ${JSON.stringify(input.alergias)}::jsonb,
             antecedentes  = ${JSON.stringify(input.antecedentes)}::jsonb,
             sexo          = COALESCE(${sexo}, sexo)
       WHERE id = ${patientId}
      RETURNING sin_alergias_conocidas, alergias, antecedentes, sexo
    `);
    const row = (
      result.rows as unknown as {
        sin_alergias_conocidas: boolean;
        alergias: Alergia[] | null;
        antecedentes: AntecedentesPaciente | null;
        sexo: SexoPaciente | null;
      }[]
    )[0];
    if (!row) return null;

    return {
      sinAlergiasConocidas: row.sin_alergias_conocidas,
      alergias: row.alergias ?? [],
      antecedentes: row.antecedentes ?? ANTECEDENTES_VACIOS,
      sexo: row.sexo,
    };
  }

  async actualizarDatos(
    tx: Tx,
    patientId: string,
    datos: { nombre?: string; telefono?: string | null; fechaNacimiento?: string; email?: string | null; canalPreferido?: BookingChannel },
  ): Promise<PatientSummary | null> {
    // COALESCE con parámetro NULL conserva lo guardado: es lo que da la
    // semántica de PATCH (campo ausente = no se toca) sin construir el SQL a
    // pedazos. El teléfono necesita además poder BORRARSE, y por eso el caso
    // de uso traduce la cadena vacía a un centinela: aquí un NULL significa
    // "no lo mandaron", no "déjalo vacío". `fechaNacimiento` no tiene ese
    // problema — no existe "borrar la fecha de nacimiento" — así que le basta
    // el mismo COALESCE que `nombre`.
    const result = await tx.execute(sql`
      UPDATE patients
         SET nombre           = COALESCE(${datos.nombre ?? null}, nombre),
             telefono         = CASE WHEN ${datos.telefono === undefined} THEN telefono
                             ELSE ${datos.telefono ?? null} END,
             fecha_nacimiento = COALESCE(${datos.fechaNacimiento ?? null}, fecha_nacimiento),
             email            = CASE WHEN ${datos.email === undefined} THEN email
                              ELSE ${datos.email ?? null} END,
             canal_preferido  = COALESCE(${datos.canalPreferido ?? null}, canal_preferido),
             email_suppressed_at = CASE
               WHEN ${datos.email === undefined} OR email IS NOT DISTINCT FROM ${datos.email ?? null}
                 THEN email_suppressed_at
               ELSE NULL
             END
       WHERE id = ${patientId}
      RETURNING id, nombre,
                date_part('year', age(fecha_nacimiento))::int AS edad,
                sexo, curp, telefono
    `);
    const row = (result.rows as unknown as PatientRow[])[0];
    if (!row) return null;
    return {
      id: row.id,
      nombre: row.nombre,
      edad: Number(row.edad),
      sexo: row.sexo,
      curp: row.curp,
      telefono: row.telefono,
    };
  }

  async existe(tx: Tx, patientId: string): Promise<boolean> {
    const result = await tx.execute(sql`SELECT 1 FROM patients WHERE id = ${patientId} LIMIT 1`);
    return result.rows.length > 0;
  }

  async nombreActual(tx: Tx, patientId: string): Promise<string | null> {
    const result = await tx.execute(
      sql`SELECT nombre FROM patients WHERE id = ${patientId} LIMIT 1`,
    );
    return (result.rows as unknown as { nombre: string }[])[0]?.nombre ?? null;
  }

  /**
   * Un solo viaje con subconsultas escalares en vez de ocho COUNT sueltos.
   *
   * Las citas cuentan solo si se ATENDIERON: una cita 'agendada' o 'cancelada'
   * de un paciente capturado por error es parte del mismo error, y exigir que
   * el usuario la borre antes convertiría la limpieza en un rompecabezas.
   * 'en_espera', 'en_consulta' y 'finalizada' sí son actos.
   */
  async contarActividadClinica(tx: Tx, patientId: string): Promise<ActividadClinicaPaciente> {
    const result = await tx.execute(sql`
      SELECT
        (SELECT count(*) FROM clinical_notes n
           JOIN clinical_records r ON r.id = n.clinical_record_id
          WHERE r.patient_id = ${patientId})                                  AS notas,
        (SELECT count(*) FROM recetas            WHERE patient_id = ${patientId}) AS recetas,
        (SELECT count(*) FROM consentimientos    WHERE patient_id = ${patientId}) AS consentimientos,
        (SELECT count(*) FROM radiografias       WHERE patient_id = ${patientId}) AS radiografias,
        (SELECT count(*) FROM presupuestos       WHERE patient_id = ${patientId}) AS presupuestos,
        -- Las facturas no cuelgan del paciente directamente: se ligan por el
        -- receptor fiscal, que es donde vive el RFC.
        (SELECT count(*) FROM facturas f
           JOIN receptores_fiscales rf ON rf.id = f.receptor_id
          WHERE rf.patient_id = ${patientId})                                 AS facturas,
        (SELECT count(*) FROM receptores_fiscales WHERE patient_id = ${patientId}) AS datos_fiscales,
        (SELECT count(*) FROM ordenes_plantillas WHERE patient_id = ${patientId}) AS ordenes_plantillas,
        (SELECT count(*) FROM appointments
          WHERE patient_id = ${patientId}
            AND estatus IN ('en_espera', 'en_consulta', 'finalizada'))        AS citas_atendidas
    `);
    const r = (result.rows as unknown as Record<string, string>[])[0]!;
    return {
      notas: Number(r.notas),
      recetas: Number(r.recetas),
      consentimientos: Number(r.consentimientos),
      radiografias: Number(r.radiografias),
      presupuestos: Number(r.presupuestos),
      facturas: Number(r.facturas),
      datosFiscales: Number(r.datos_fiscales),
      ordenesPlantillas: Number(r.ordenes_plantillas),
      citasAtendidas: Number(r.citas_atendidas),
    };
  }

  async archivar(tx: Tx, patientId: string, archivadoPor: string | null): Promise<boolean> {
    // archivadoPor null = reactivar. Se limpian las dos columnas juntas para
    // que no quede un "archivado por Fulano" sobre un paciente activo.
    // Dos consultas y no una con CASE: `now()` es un fragmento SQL y `null` un
    // parámetro; meterlos en el mismo hueco del template hace que el tipo de
    // la columna dependa de la rama. Explícito se lee mejor que el truco.
    const result = archivadoPor
      ? await tx.execute(sql`
          UPDATE patients SET archivado_en = now(), archivado_por = ${archivadoPor}
           WHERE id = ${patientId} RETURNING id
        `)
      : await tx.execute(sql`
          UPDATE patients SET archivado_en = NULL, archivado_por = NULL
           WHERE id = ${patientId} RETURNING id
        `);
    return result.rows.length > 0;
  }

  async eliminar(tx: Tx, patientId: string): Promise<boolean> {
    const result = await tx.execute(
      sql`DELETE FROM patients WHERE id = ${patientId} RETURNING id`,
    );
    return result.rows.length > 0;
  }
}
