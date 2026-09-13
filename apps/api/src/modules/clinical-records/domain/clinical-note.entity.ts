import {
  perfilDe,
  type ClinicalNoteStatus,
  type ClinicalNoteType,
  type EspecialidadKey,
  type FirmaMedica,
  type NotaEvolucionContent,
} from '@healthflow/shared-types';
import { evaluarEsquema, validarCierre } from './motor-reglas';
import { validarEstructuraNota } from './estructura-nota';
import {
  EstructuraNotaInvalidaError,
  FirmaIncompletaError,
  IncompleteClinicalNoteError,
  NoteAlreadyClosedError,
} from './clinical-note.errors';

export interface ClinicalNoteProps {
  id: string;
  clinicalRecordId: string;
  appointmentId: string;
  doctorId: string;
  tipoNota: ClinicalNoteType;
  estatus: ClinicalNoteStatus;
  contenido: NotaEvolucionContent;
  cerradoEn: Date | null;
  createdAt: Date;
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
  get doctorId(): string {
    return this.props.doctorId;
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

  /**
   * Autosave del borrador. Prohibido si la nota ya está cerrada.
   *
   * `especialidad` la resuelve el servidor (la actual del médico mientras la
   * nota sea borrador); si no se da, se conserva la guardada.
   */
  saveDraft(
    contenido: NotaEvolucionContent,
    especialidad: EspecialidadKey | undefined = this.props.contenido.especialidad,
  ): void {
    this.assertEditable();
    this.props.contenido = this.sellar(contenido, especialidad);
  }

  /**
   * Cierra la nota (inmutable). Valida NOM-004 MÁS los campos obligatorios de
   * la especialidad con la que se abrió; si faltan campos, lanza
   * IncompleteClinicalNoteError con la lista. Estampa la firma del médico y la
   * fecha de cierre.
   */
  close(
    contenido: NotaEvolucionContent,
    firma: FirmaMedica,
    now: Date = new Date(),
    especialidad: EspecialidadKey | undefined = this.props.contenido.especialidad,
  ): void {
    this.assertEditable();
    const sellado = this.sellar(contenido, especialidad);

    const faltantesFirma = [
      ...(firma.medicoNombre?.trim() ? [] : (['medicoNombre'] as const)),
      ...(firma.cedula?.trim() ? [] : (['cedula'] as const)),
    ];
    if (faltantesFirma.length > 0) {
      throw new FirmaIncompletaError(faltantesFirma);
    }

    const esquema = evaluarEsquema(sellado);
    const errores = validarCierre(sellado, esquema);
    if (errores.length > 0) {
      throw new IncompleteClinicalNoteError(errores);
    }

    // El esquema se congela con la firma: dentro de años, la nota debe poder
    // leerse con los requisitos que tenía el día que se firmó.
    this.props.contenido = { ...sellado, firma, esquemaAlCierre: esquema };
    this.props.estatus = 'cerrada';
    this.props.cerradoEn = now;
  }

  /**
   * El contenido llega entero del cliente, pero hay campos que el cliente NO
   * decide: el tipo de nota, la especialidad, la plantilla y el contexto los
   * fija el servidor, y la firma sólo se estampa al cerrar. Sin este sello un
   * navegador modificado podía mandar `tipoNota: 'nota_evolucion'` en una
   * historia clínica y cerrarla sin los antecedentes que exige NOM-004.
   *
   * También valida la forma del contenido antes de aceptarlo.
   */
  private sellar(
    contenido: NotaEvolucionContent,
    especialidad: EspecialidadKey | undefined,
  ): NotaEvolucionContent {
    const errores = validarEstructuraNota(contenido);
    if (errores.length > 0) throw new EstructuraNotaInvalidaError(errores);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { firma, esquemaAlCierre, ...resto } = contenido;
    const guardado = this.props.contenido;
    const especialidadSellada = guardado.plantillaVersion ? guardado.especialidad : especialidad;

    // El motivo de consulta activa reglas, así que sólo vale uno del catálogo
    // ACTIVO de la nota; un borrador no aprobado no ofrece ninguno.
    if (resto.motivoConsulta !== undefined) {
      const motivos = perfilDe(especialidadSellada, guardado.plantillaVersion).motivosConsulta ?? [];
      if (!motivos.some((m) => m.id === resto.motivoConsulta)) {
        throw new EstructuraNotaInvalidaError(['motivoConsulta']);
      }
    }

    return {
      ...resto,
      tipoNota: this.props.tipoNota,
      // Con plantilla versionada, la especialidad quedó estampada al crear el
      // borrador junto con el contexto que se calculó para ella: seguir la
      // especialidad actual del médico los desalinearía. Legacy conserva el
      // comportamiento anterior (la actual mientras sea borrador).
      especialidad: especialidadSellada,
      plantillaVersion: guardado.plantillaVersion,
      contextoNota: guardado.contextoNota,
    };
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
