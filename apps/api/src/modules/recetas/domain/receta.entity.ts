import type {
  DiagnosticoCie10,
  MedicamentoRecetado,
  RecetaContent,
  EmisorReceta,
  PacienteReceta,
} from '@healthflow/shared-types';
import {
  MedicamentoControladoNoEmisibleError,
  RecetaIncompletaError,
} from './receta.errors';
import { RecetaValidator } from './receta-validator';

export interface EmitirRecetaProps {
  emisor: EmisorReceta;
  paciente: PacienteReceta;
  diagnosticos: DiagnosticoCie10[];
  medicamentos: MedicamentoRecetado[];
  indicacionesGenerales: string | null;
  alergiasSnapshot: string[];
}

/**
 * Entidad de dominio Receta. Solo sabe emitirse: una vez emitida es inmutable
 * (la base ni siquiera concede UPDATE), así que no hay métodos de edición y la
 * cancelación es otra entidad.
 */
export class Receta {
  private constructor(readonly contenido: RecetaContent) {}

  static emitir(props: EmitirRecetaProps): Receta {
    // ── El orden importa ─────────────────────────────────────────
    // Primero el bloqueo por fracción y DESPUÉS los campos faltantes: si el
    // médico prescribió clonazepam, decirle "te falta la dosis" antes de
    // decirle "esto no se puede emitir aquí" lo manda a llenar campos para
    // nada, y a repetir el intento.
    const bloqueados = RecetaValidator.medicamentosBloqueados(props.medicamentos);
    if (bloqueados.length > 0) {
      throw new MedicamentoControladoNoEmisibleError(bloqueados);
    }

    const faltantes = RecetaValidator.camposFaltantes(
      props.emisor,
      props.paciente,
      props.medicamentos,
    );
    if (faltantes.length > 0) {
      throw new RecetaIncompletaError(faltantes);
    }

    return new Receta({
      emisor: props.emisor,
      paciente: props.paciente,
      diagnosticos: props.diagnosticos,
      medicamentos: props.medicamentos.map(normalizar),
      indicacionesGenerales: props.indicacionesGenerales?.trim() || null,
      alergiasSnapshot: props.alergiasSnapshot,
    });
  }
}

/** Recorta el ruido de captura antes de congelar el snapshot. */
function normalizar(m: MedicamentoRecetado): MedicamentoRecetado {
  return {
    clave: m.clave,
    denominacionGenerica: m.denominacionGenerica.trim(),
    denominacionDistintiva: m.denominacionDistintiva?.trim() || null,
    presentacion: m.presentacion.trim(),
    dosis: m.dosis.trim(),
    via: m.via.trim(),
    frecuencia: m.frecuencia.trim(),
    duracion: m.duracion.trim(),
    indicaciones: m.indicaciones?.trim() || null,
    fraccion: m.fraccion,
  };
}
