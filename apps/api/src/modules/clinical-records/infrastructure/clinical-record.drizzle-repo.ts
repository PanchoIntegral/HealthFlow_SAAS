import { BadRequestException, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ANTECEDENTES_VACIOS,
  EMPTY_HISTORIA_CLINICA,
  EMPTY_NOTA_EVOLUCION,
  esEspecialidadValida,
  type Alergia,
  type AntecedentesPaciente,
  type ClinicalNoteType,
  type ClinicalNoteStatus,
  type ClinicalRecordView,
  type CorreccionNota,
  type EspecialidadKey,
  type MapaCorporal,
  type NotaEvolucionContent,
  type Odontograma,
  type Podograma,
  type SexoPaciente,
} from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import { ClinicalNote } from '../domain/clinical-note.entity';
import type {
  ClinicalRecordRepository,
  CreateDraftNoteInput,
  NuevaCorreccionInput,
  PaginaNotas,
} from '../domain/clinical-record.repository';

/**
 * El cursor es opaco a propósito: es `<created_at ISO>|<id>` en base64url, y
 * su formato es un detalle del servidor que el cliente no debe interpretar ni
 * construir. Si mañana el orden del historial cambia, cambia esto y nada más.
 */
function codificarCursor(row: { created_at: Date; id: string }): string {
  return Buffer.from(`${new Date(row.created_at).toISOString()}|${row.id}`).toString('base64url');
}

function decodificarCursor(cursor: string | null): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  // Un cursor corrupto o inventado se rechaza en vez de degradar a "primera
  // página": devolver silenciosamente el inicio del expediente haría que el
  // médico creyera estar viendo la continuación del historial.
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt)) || !UUID_RE.test(id)) {
    throw new BadRequestException('Cursor de paginación inválido');
  }
  return { createdAt, id };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface NoteRow {
  id: string;
  clinical_record_id: string;
  appointment_id: string;
  doctor_id: string;
  tipo_nota: ClinicalNoteType;
  estatus: ClinicalNoteStatus;
  contenido_nom004: NotaEvolucionContent;
  cerrado_en: Date | null;
  created_at: Date;
}

/**
 * Adaptador Drizzle/Postgres del expediente clínico. Corre sobre la transacción
 * con tenant fijado: RLS aísla las lecturas y el DEFAULT current_tenant_id()
 * rellena tenant_id en los inserts.
 */
interface CorreccionRow {
  id: string;
  clinical_note_id: string;
  texto: string;
  autor_nombre: string;
  autor_cedula: string | null;
  created_at: Date;
}

function toCorreccion(row: CorreccionRow): CorreccionNota {
  return {
    id: row.id,
    texto: row.texto,
    autorNombre: row.autor_nombre,
    autorCedula: row.autor_cedula,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

@Injectable()
export class DrizzleClinicalRecordRepository implements ClinicalRecordRepository {
  async ensureRecordForPatient(tx: Tx, patientId: string): Promise<string> {
    const result = await tx.execute(sql`
      INSERT INTO clinical_records (patient_id)
      VALUES (${patientId})
      ON CONFLICT (patient_id) DO UPDATE SET patient_id = EXCLUDED.patient_id
      RETURNING id
    `);
    return (result.rows[0] as { id: string }).id;
  }

  async createDraftNote(tx: Tx, input: CreateDraftNoteInput): Promise<string> {
    const base = input.tipoNota === 'historia_clinica' ? EMPTY_HISTORIA_CLINICA : EMPTY_NOTA_EVOLUCION;
    // La especialidad queda grabada dentro del propio contenido: la nota es
    // autodescriptiva y no depende de cómo esté configurado el médico el día
    // que alguien la vuelva a abrir.
    const contenido = JSON.stringify({
      ...base,
      especialidad: input.especialidad,
      extension: {},
      // Arrastra el estado dental de la visita anterior: el dentista marca lo
      // que CAMBIÓ, no vuelve a dibujar la boca entera cada vez.
      ...(input.odontograma ? { odontograma: input.odontograma } : {}),
      // Mismo criterio para el pie: una úlcera que lleva meses no se vuelve a
      // marcar de cero en cada consulta.
      ...(input.podograma ? { podograma: input.podograma } : {}),
      // Las heridas continúan entre curaciones; se parte de la última
      // localización firmada y el médico ajusta lo que cambió.
      ...(input.mapaCorporal ? { mapaCorporal: input.mapaCorporal } : {}),
    } satisfies NotaEvolucionContent);
    const result = await tx.execute(sql`
      INSERT INTO clinical_notes (clinical_record_id, appointment_id, doctor_id, tipo_nota, contenido_nom004, estatus)
      VALUES (${input.clinicalRecordId}, ${input.appointmentId}, ${input.doctorId}, ${input.tipoNota}, ${contenido}::jsonb, 'borrador')
      RETURNING id
    `);
    return (result.rows[0] as { id: string }).id;
  }

  async hasAnyNoteForRecord(tx: Tx, clinicalRecordId: string): Promise<boolean> {
    const result = await tx.execute(sql`
      SELECT 1 FROM clinical_notes WHERE clinical_record_id = ${clinicalRecordId} LIMIT 1
    `);
    return result.rows.length > 0;
  }

  async findNoteByAppointment(
    tx: Tx,
    appointmentId: string,
    opts: { forUpdate?: boolean } = {},
  ): Promise<ClinicalNote | null> {
    const result = await tx.execute(sql`
      SELECT id, clinical_record_id, appointment_id, doctor_id, tipo_nota,
             estatus, contenido_nom004, cerrado_en, created_at
        FROM clinical_notes
       WHERE appointment_id = ${appointmentId}
       LIMIT 1
       ${opts.forUpdate ? sql`FOR UPDATE` : sql``}
    `);
    const row = (result.rows as unknown as NoteRow[])[0];
    if (!row) return null;
    return ClinicalNote.fromState({
      id: row.id,
      clinicalRecordId: row.clinical_record_id,
      appointmentId: row.appointment_id,
      doctorId: row.doctor_id,
      tipoNota: row.tipo_nota,
      estatus: row.estatus,
      contenido: row.contenido_nom004,
      cerradoEn: row.cerrado_en ? new Date(row.cerrado_en) : null,
      createdAt: new Date(row.created_at),
    });
  }

  async saveDraftContent(tx: Tx, note: ClinicalNote): Promise<boolean> {
    const s = note.toState();
    // Sin tocar estatus ni cerrado_en, y sólo si sigue en borrador. Antes el
    // autosave reescribía las tres columnas sin condición: uno que hubiera
    // leído la nota justo antes del cierre la devolvía a 'borrador' con el
    // contenido previo a la firma.
    const result = await tx.execute(sql`
      UPDATE clinical_notes
         SET contenido_nom004 = ${JSON.stringify(s.contenido)}::jsonb
       WHERE id = ${s.id} AND estatus = 'borrador'
      RETURNING id
    `);
    return result.rows.length > 0;
  }

  async saveClosedNote(tx: Tx, note: ClinicalNote): Promise<boolean> {
    const s = note.toState();
    const result = await tx.execute(sql`
      UPDATE clinical_notes
         SET contenido_nom004 = ${JSON.stringify(s.contenido)}::jsonb,
             estatus = ${s.estatus},
             cerrado_en = ${s.cerradoEn ? s.cerradoEn.toISOString() : null}
       WHERE id = ${s.id} AND estatus = 'borrador'
      RETURNING id
    `);
    return result.rows.length > 0;
  }

  async getDoctorSignature(
    tx: Tx,
    doctorId: string,
  ): Promise<{ nombre: string; cedula: string | null } | null> {
    const result = await tx.execute(sql`
      SELECT nombre, cedula_profesional AS cedula FROM users WHERE id = ${doctorId} LIMIT 1
    `);
    const row = (result.rows as unknown as { nombre: string; cedula: string | null }[])[0];
    return row ?? null;
  }

  async getDoctorEspecialidad(tx: Tx, doctorId: string): Promise<EspecialidadKey> {
    const result = await tx.execute(sql`
      SELECT especialidad_key FROM users WHERE id = ${doctorId} LIMIT 1
    `);
    const key = (result.rows as unknown as { especialidad_key: string }[])[0]?.especialidad_key;
    // Una clave que ya no exista en el catálogo degrada a 'general' en vez de
    // romper el inicio de consulta.
    return esEspecialidadValida(key) ? key : 'general';
  }

  async getUltimoOdontograma(tx: Tx, clinicalRecordId: string): Promise<Odontograma | null> {
    return this.ultimoInstrumento<Odontograma>(tx, clinicalRecordId, 'odontograma');
  }

  async getUltimoPodograma(tx: Tx, clinicalRecordId: string): Promise<Podograma | null> {
    return this.ultimoInstrumento<Podograma>(tx, clinicalRecordId, 'podograma');
  }

  async getUltimoMapaCorporal(tx: Tx, clinicalRecordId: string): Promise<MapaCorporal | null> {
    return this.ultimoInstrumento<MapaCorporal>(tx, clinicalRecordId, 'mapaCorporal');
  }

  /**
   * Último valor cerrado de un instrumento gráfico del expediente.
   *
   * Solo notas CERRADAS: un borrador a medias no es un estado del que se pueda
   * partir con confianza.
   *
   * `llave` NO viene del usuario — la fijan los métodos de arriba con literales
   * — pero aun así va parametrizada y no interpolada en el SQL: es el tipo de
   * atajo que sobrevive al refactor que sí la expone.
   */
  private async ultimoInstrumento<T>(
    tx: Tx,
    clinicalRecordId: string,
    llave: 'odontograma' | 'podograma' | 'mapaCorporal',
  ): Promise<T | null> {
    const result = await tx.execute(sql`
      SELECT contenido_nom004->${llave} AS valor
        FROM clinical_notes
       WHERE clinical_record_id = ${clinicalRecordId}
         AND estatus = 'cerrada'
         AND contenido_nom004 ? ${llave}
       ORDER BY cerrado_en DESC
       LIMIT 1
    `);
    return (result.rows as unknown as { valor: T | null }[])[0]?.valor ?? null;
  }

  async getRecordView(
    tx: Tx,
    patientId: string,
    page: PaginaNotas,
  ): Promise<ClinicalRecordView | null> {
    const recordRes = await tx.execute(sql`
      SELECT cr.id AS record_id, cr.patient_id, cr.abierto_en, p.nombre AS patient_nombre,
             p.sin_alergias_conocidas, p.alergias, p.antecedentes, p.sexo, p.telefono,
             p.fecha_nacimiento
        FROM clinical_records cr
        JOIN patients p ON p.id = cr.patient_id
       WHERE cr.patient_id = ${patientId}
       LIMIT 1
    `);
    const record = (
      recordRes.rows as unknown as {
        record_id: string;
        patient_id: string;
        abierto_en: Date;
        patient_nombre: string;
        telefono: string | null;
        fecha_nacimiento: string;
        sin_alergias_conocidas: boolean;
        sexo: SexoPaciente | null;
        alergias: Alergia[] | null;
        antecedentes: AntecedentesPaciente | null;
      }[]
    )[0];
    if (!record) return null;

    const desde = decodificarCursor(page.cursor);

    // Se piden limit+1 filas: la de más es solo el testigo de que hay página
    // siguiente, y no se devuelve. Evita un count extra por página.
    //
    // Keyset y no OFFSET: el expediente se recorre de lo más reciente hacia
    // atrás, y el OFFSET obliga a Postgres a contar y descartar todas las
    // notas anteriores — se degrada justo en los pacientes con más historia,
    // que son los que más importan. La comparación de tupla
    // (created_at, id) < (…) va con el ORDER BY y con
    // clinical_notes_tenant_record_created_idx (ver 0021).
    //
    // `id` desempata: dos notas creadas en el mismo instante (autoguardado,
    // migraciones) tendrían un orden inestable entre páginas, y una nota
    // podría repetirse o desaparecer al pasar de página.
    const notesRes = await tx.execute(sql`
      SELECT id, clinical_record_id, appointment_id, doctor_id, tipo_nota,
             estatus, contenido_nom004, cerrado_en, created_at
        FROM clinical_notes
       WHERE clinical_record_id = ${record.record_id}
         ${desde ? sql`AND (created_at, id) < (${desde.createdAt}::timestamptz, ${desde.id}::uuid)` : sql``}
       ORDER BY created_at DESC, id DESC
       LIMIT ${page.limit + 1}
    `);

    const filas = notesRes.rows as unknown as NoteRow[];
    const hayMas = filas.length > page.limit;
    const pagina = hayMas ? filas.slice(0, page.limit) : filas;
    const ultima = pagina[pagina.length - 1];

    // Correcciones de TODAS las notas de la página en una sola consulta: una
    // por nota sería un N+1 en la pantalla que más se abre del sistema.
    const correccionesPorNota = await this.correccionesDe(
      tx,
      pagina.map((f) => f.id),
    );

    // El total es del expediente entero, no de la página: la cabecera dice
    // "N notas" y ahí un número parcial sería engañoso.
    const totalRes = await tx.execute(sql`
      SELECT count(*)::int AS total FROM clinical_notes
       WHERE clinical_record_id = ${record.record_id}
    `);
    const totalNotas = (totalRes.rows as unknown as { total: number }[])[0]?.total ?? 0;

    return {
      recordId: record.record_id,
      patientId: record.patient_id,
      patientNombre: record.patient_nombre,
      patientTelefono: record.telefono,
      patientFechaNacimiento: record.fecha_nacimiento,
      abiertoEn: new Date(record.abierto_en).toISOString(),
      nextCursor: hayMas && ultima ? codificarCursor(ultima) : null,
      totalNotas,
      notas: pagina.map((row) => ({
        id: row.id,
        appointmentId: row.appointment_id,
        doctorId: row.doctor_id,
        tipoNota: row.tipo_nota,
        estatus: row.estatus,
        contenido: row.contenido_nom004,
        cerradoEn: row.cerrado_en ? new Date(row.cerrado_en).toISOString() : null,
        createdAt: new Date(row.created_at).toISOString(),
        correcciones: correccionesPorNota.get(row.id) ?? [],
      })),
      historial: {
        sinAlergiasConocidas: record.sin_alergias_conocidas,
        // Los `?? []` cubren pacientes creados antes de la migración 0013 y
        // cualquier fila con el jsonb en NULL: la alerta nunca debe reventar.
        alergias: record.alergias ?? [],
        antecedentes: record.antecedentes ?? ANTECEDENTES_VACIOS,
        sexo: record.sexo,
      },
    };
  }

  /** Correcciones agrupadas por nota, en orden cronológico. */
  private async correccionesDe(
    tx: Tx,
    noteIds: string[],
  ): Promise<Map<string, CorreccionNota[]>> {
    const porNota = new Map<string, CorreccionNota[]>();
    if (noteIds.length === 0) return porNota;

    const res = await tx.execute(sql`
      SELECT id, clinical_note_id, texto, autor_nombre, autor_cedula, created_at
        FROM notas_correccion
       WHERE clinical_note_id IN (${sql.join(
         noteIds.map((id) => sql`${id}::uuid`),
         sql`, `,
       )})
       ORDER BY created_at ASC
    `);

    for (const row of res.rows as unknown as CorreccionRow[]) {
      const lista = porNota.get(row.clinical_note_id) ?? [];
      lista.push(toCorreccion(row));
      porNota.set(row.clinical_note_id, lista);
    }
    return porNota;
  }

  async getCorrecciones(tx: Tx, noteId: string): Promise<CorreccionNota[]> {
    return (await this.correccionesDe(tx, [noteId])).get(noteId) ?? [];
  }

  async getNotaBasica(tx: Tx, noteId: string): Promise<{ id: string; estatus: string } | null> {
    const res = await tx.execute(sql`
      SELECT id, estatus FROM clinical_notes WHERE id = ${noteId} LIMIT 1
    `);
    const row = (res.rows as unknown as { id: string; estatus: string }[])[0];
    return row ?? null;
  }

  async crearCorreccion(tx: Tx, input: NuevaCorreccionInput): Promise<CorreccionNota> {
    // El nombre y la cédula se COPIAN aquí, no se resuelven al leer: la firma
    // de una adenda es la del momento en que se hizo (mismo criterio que la
    // firma de la nota y el emisor de la receta).
    const res = await tx.execute(sql`
      INSERT INTO notas_correccion (clinical_note_id, autor_id, autor_nombre, autor_cedula, texto)
      SELECT ${input.clinicalNoteId}, u.id, u.nombre, u.cedula_profesional, ${input.texto}
        FROM users u
       WHERE u.id = ${input.autorId}
      RETURNING id, clinical_note_id, texto, autor_nombre, autor_cedula, created_at
    `);
    return toCorreccion((res.rows as unknown as CorreccionRow[])[0]!);
  }
}
