import type { ClinicalNoteType, ContextoNota, EspecialidadKey } from '@healthflow/shared-types';

/** Lo que el expediente ya tiene CERRADO; los borradores abandonados no cuentan. */
export interface HistorialContexto {
  /** Hay una historia clínica general firmada (incluye las legacy). */
  historiaGeneral: boolean;
  /** Hay una valoración inicial firmada en la especialidad de esta consulta. */
  inicialEspecialidad: boolean;
}

export interface DecisionContexto {
  tipoNota: ClinicalNoteType;
  contextoNota: ContextoNota;
}

/**
 * Qué clase de nota abre una consulta con plantilla v1.
 *
 *   sin historia general cerrada            → historia clínica general
 *   sin valoración inicial en la especialidad → historia clínica, inicial de especialidad
 *   en otro caso                             → nota de evolución, seguimiento
 *
 * No basta con "¿es la primera nota del expediente?": quien ya tiene historia
 * de medicina general necesita igualmente una primera valoración completa
 * cuando llega a cardiología o nutrición.
 *
 * En medicina general la valoración inicial ES la historia general, así que
 * con ésta firmada ya sólo quedan seguimientos.
 */
export function decidirContexto(
  especialidad: EspecialidadKey,
  historial: HistorialContexto,
): DecisionContexto {
  if (!historial.historiaGeneral) {
    return { tipoNota: 'historia_clinica', contextoNota: 'general' };
  }
  if (especialidad !== 'general' && !historial.inicialEspecialidad) {
    return { tipoNota: 'historia_clinica', contextoNota: 'inicial_especialidad' };
  }
  return { tipoNota: 'nota_evolucion', contextoNota: 'seguimiento' };
}
