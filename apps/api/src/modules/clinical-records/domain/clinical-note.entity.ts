import type {
  ClinicalNoteStatus,
  ClinicalNoteType,
  FirmaMedica,
  NotaEvolucionContent,
} from '@healthflow/shared-types';
import { NOM004Validator } from './nom004-validator';
import { IncompleteClinicalNoteError, NoteAlreadyClosedError } from './clinical-note.errors';

export interface ClinicalNoteProps {
  id: string;
  clinicalRecordId: string;
  appointmentId: string;
  doctorId: string;
  tipoNota: ClinicalNoteType;
  estatus: ClinicalNoteStatus;
  contenido: NotaEvolucionContent;
  cerradoEn: Date | null;
}

/**
 * Entidad de dominio de la nota clínica. Concentra la regla no negociable de
 * NOM-004: una nota `cerrada` es INMUTABLE, y el cierre exige validar los
 * campos obligatorios. Todo esto es puro y testeable sin base de datos.
 */
export class ClinicalNote {
  private constructor(private readonly props: ClinicalNoteProps) {}

  static fromState(props: ClinicalNoteProps): ClinicalNote {
    return new ClinicalNote({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get estatus(): ClinicalNoteStatus {
    return this.props.estatus;
  }
  get contenido(): NotaEvolucionContent {
    return this.props.contenido;
  }
  get cerradoEn(): Date | null {
    return this.props.cerradoEn;
  }

  /** Autosave del borrador. Prohibido si la nota ya está cerrada. */
  saveDraft(contenido: NotaEvolucionContent): void {
    this.assertEditable();
    this.props.contenido = contenido;
  }

  /**
   * Cierra la nota (inmutable). Valida NOM-004 sobre el contenido dado; si
   * faltan campos, lanza IncompleteClinicalNoteError con la lista. Estampa la
   * firma del médico y la fecha de cierre.
   */
  close(contenido: NotaEvolucionContent, firma: FirmaMedica, now: Date = new Date()): void {
    this.assertEditable();

    const missing = NOM004Validator.validateNotaEvolucion(contenido);
    if (missing.length > 0) {
      throw new IncompleteClinicalNoteError(missing);
    }

    this.props.contenido = { ...contenido, firma };
    this.props.estatus = 'cerrada';
    this.props.cerradoEn = now;
  }

  private assertEditable(): void {
    if (this.props.estatus === 'cerrada') {
      throw new NoteAlreadyClosedError();
    }
  }

  toState(): ClinicalNoteProps {
    return { ...this.props };
  }
}
