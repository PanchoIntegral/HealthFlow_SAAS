import type {
  CorreccionNota,
  ClinicalNoteType,
  ClinicalRecordView,
  ContextoNota,
  ReferenciaAntecedentes,
  EspecialidadKey,
  MapaCorporal,
  Odontograma,
  PlantillaVersion,
  Podograma,
} from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import type { ClinicalNote } from './clinical-note.entity';
import type { HistorialContexto } from './contexto-nota';
import type { UltimaAuditoriaAutosave } from './auditoria-nota';

export interface CreateDraftNoteInput {
  clinicalRecordId: string;
  appointmentId: string;
  doctorId: string;
  /** Lo decide el servidor al iniciar consulta (ver decidirContexto para v1). */
  tipoNota: ClinicalNoteType;
  /**
   * Se estampa en el contenido de la nota al crearla y ya no cambia. Si el
   * médico cambia de especialidad más adelante, sus notas anteriores deben
   * seguir mostrándose y validándose con la que tenían al firmarse.
   */
  especialidad: EspecialidadKey;
  /** Estado dental heredado de la última nota cerrada; ausente en la primera visita. */
  odontograma?: Odontograma;
  /** Mapa podológico heredado de la última nota cerrada; ausente en la primera visita. */
  podograma?: Podograma;
  /** Ubicaciones de heridas heredadas de la última nota cerrada. */
  mapaCorporal?: MapaCorporal;
  /**
   * Presente sólo si notas_v2 está activo para la especialidad: estampa
   * plantilla y contexto en columnas y contenido. Ausente = nota legacy, con
   * las columnas en NULL, exactamente como antes.
   */
  v2?: { plantillaVersion: PlantillaVersion; contextoNota: ContextoNota };
}

/**
 * Puerto del repositorio del expediente clínico. Corre sobre la transacción
 * con tenant fijado (RLS). El dominio/aplicación dependen de esta interface,
 * no de Drizzle.
 */
export interface ClinicalRecordRepository {
  /** Devuelve el id del expediente del paciente, creándolo si es su primera consulta. */
  ensureRecordForPatient(tx: Tx, patientId: string): Promise<string>;

  /** Crea la nota borrador ligada a la cita y devuelve su id. */
  createDraftNote(tx: Tx, input: CreateDraftNoteInput): Promise<string>;

  /** notas_v2 encendido para esta especialidad en la clínica activa. Sin fila = apagado. */
  notasV2Habilitado(tx: Tx, especialidad: EspecialidadKey): Promise<boolean>;

  /** Qué valoraciones CERRADAS tiene el expediente, para decidir el contexto de la nota. */
  historialContexto(
    tx: Tx,
    clinicalRecordId: string,
    especialidad: EspecialidadKey,
  ): Promise<HistorialContexto>;

  /**
   * Antecedentes vigentes del expediente: los de la nota FIRMADA más reciente
   * que los capturó (historia general, o valoración de especialidad que los
   * actualizó). null si no hay ninguna.
   */
  getReferenciaAntecedentes(tx: Tx, clinicalRecordId: string): Promise<ReferenciaAntecedentes | null>;

  /** Último registro de auditoría de autosave de la nota, para no repetirlo. null si no hay. */
  ultimaAuditoriaAutosave(tx: Tx, noteId: string): Promise<UltimaAuditoriaAutosave | null>;

  /** True si el expediente ya tiene alguna nota (de cualquier tipo/estatus). */
  hasAnyNoteForRecord(tx: Tx, clinicalRecordId: string): Promise<boolean>;

  /**
   * `forUpdate` bloquea la fila hasta el fin de la transacción: el cierre lo
   * usa para que ningún autosave concurrente se cuele entre validar y firmar.
   */
  findNoteByAppointment(
    tx: Tx,
    appointmentId: string,
    opts?: { forUpdate?: boolean },
  ): Promise<ClinicalNote | null>;

  /**
   * Persiste el contenido de un BORRADOR. Condicionado a `estatus='borrador'`
   * en la propia sentencia: devuelve false si la nota se cerró entre la
   * lectura y la escritura, en vez de pisar el documento firmado.
   */
  saveDraftContent(tx: Tx, note: ClinicalNote): Promise<boolean>;

  /** Persiste el cierre (contenido firmado, estatus y fecha). False si ya estaba cerrada. */
  saveClosedNote(tx: Tx, note: ClinicalNote): Promise<boolean>;

  /** Datos de firma del médico (para estampar al cerrar la nota). null si el usuario no existe. */
  getDoctorSignature(
    tx: Tx,
    doctorId: string,
  ): Promise<{ nombre: string; cedula: string | null } | null>;

  /** Especialidad configurada del médico, para estampar la nota al abrirla. */
  getDoctorEspecialidad(tx: Tx, doctorId: string): Promise<EspecialidadKey>;

  /**
   * Odontograma de la última nota CERRADA del expediente, para arrastrar el
   * estado dental a la consulta nueva. null si no hay ninguna.
   */
  getUltimoOdontograma(tx: Tx, clinicalRecordId: string): Promise<Odontograma | null>;

  /**
   * Podograma de la última nota CERRADA del expediente. Mismo criterio que el
   * odontograma: las lesiones del pie evolucionan lento y el podólogo ajusta
   * lo que cambió en vez de volver a marcarlo todo.
   */
  getUltimoPodograma(tx: Tx, clinicalRecordId: string): Promise<Podograma | null>;

  /**
   * Mapa corporal de la última nota CERRADA: una herida suele requerir varias
   * curaciones y el médico sólo debe ajustar altas, cierres o sitios nuevos.
   */
  getUltimoMapaCorporal(tx: Tx, clinicalRecordId: string): Promise<MapaCorporal | null>;

  /**
   * Expediente de un paciente con UNA PÁGINA de su historial, de la nota más
   * reciente a la más antigua.
   *
   * Paginado y no completo: el historial de un paciente crónico crece sin
   * techo (conservación NOM-004), y traerlo entero en cada apertura es la
   * carga que peor envejece del sistema. El expediente sigue completo y
   * accesible — se recorre por páginas, no se recorta.
   */
  getRecordView(tx: Tx, patientId: string, page: PaginaNotas): Promise<ClinicalRecordView | null>;

  /** Estatus de una nota, para decidir si admite corrección. null si no existe en el tenant. */
  getNotaBasica(tx: Tx, noteId: string): Promise<{ id: string; estatus: string } | null>;

  /**
   * Agrega una corrección (adenda) a una nota cerrada. NUNCA modifica la nota:
   * la NOM-004 prohíbe enmendaduras, así que la rectificación se guarda al
   * lado, con la firma congelada de quien la hace.
   */
  crearCorreccion(tx: Tx, input: NuevaCorreccionInput): Promise<CorreccionNota>;

  /** Correcciones de UNA nota, en orden cronológico. */
  getCorrecciones(tx: Tx, noteId: string): Promise<CorreccionNota[]>;
}

export interface NuevaCorreccionInput {
  clinicalNoteId: string;
  autorId: string;
  texto: string;
}

/** Ventana del historial a devolver. `cursor` null = primera página. */
export interface PaginaNotas {
  limit: number;
  cursor: string | null;
}

export const CLINICAL_RECORD_REPOSITORY = Symbol('CLINICAL_RECORD_REPOSITORY');
