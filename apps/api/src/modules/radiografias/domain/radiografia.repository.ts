import type { Tx } from '../../../db/drizzle';

export interface NewRadiografiaInput {
  patientId: string;
  storageKey: string;
  mimeType: string;
  subidoPor: string;
}

export interface RadiografiaRow {
  id: string;
  patientId: string;
  storageKey: string;
  mimeType: string;
  subidoPorNombre: string;
  createdAt: string;
}

/**
 * Puerto del repositorio de radiografías. `crear`/`listarPorPaciente` operan
 * sobre metadata pura (sin `url`, que se genera en la capa de aplicación
 * consultando el AlmacenamientoPort) — el repo no sabe nada de storage.
 */
export interface RadiografiaRepository {
  crear(tx: Tx, input: NewRadiografiaInput): Promise<RadiografiaRow>;
  listarPorPaciente(tx: Tx, patientId: string): Promise<RadiografiaRow[]>;
  /** Devuelve la fila borrada (para poder limpiar el objeto en storage), o null si no existía. */
  eliminar(tx: Tx, id: string): Promise<RadiografiaRow | null>;
}

export const RADIOGRAFIA_REPOSITORY = Symbol('RADIOGRAFIA_REPOSITORY');
