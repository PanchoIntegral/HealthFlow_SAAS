import type { RecetaDetalle, RecetaView, SexoPaciente } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import type { Receta } from './receta.entity';

/**
 * Todo lo que hace falta para armar el snapshot del emisor y del paciente en
 * una sola consulta. Se lee al emitir y se congela dentro de `contenido`.
 */
export interface ContextoEmision {
  medicoNombre: string;
  cedulaProfesional: string | null;
  cedulaEspecialidad: string | null;
  especialidad: string | null;
  institucionTitulo: string | null;
  nombreClinica: string;
  direccionClinica: string | null;
  telefonoClinica: string | null;
  /** Clave de storage, NO url — se congela así en el snapshot (ver EmisorReceta). */
  logoStorageKey: string | null;
  leyendaPie: string | null;
  pacienteNombre: string;
  pacienteFechaNacimiento: string;
  pacienteSexo: SexoPaciente | null;
  pacienteAlergias: string[];
}

export interface CrearRecetaInput {
  patientId: string;
  doctorId: string;
  appointmentId: string | null;
  receta: Receta;
}

export interface RecetaRepository {
  /** null si el paciente no existe en el tenant activo (RLS ya lo filtró). */
  cargarContextoEmision(
    tx: Tx,
    patientId: string,
    doctorId: string,
  ): Promise<ContextoEmision | null>;

  /**
   * Fracción del art. 226 de cada clave del catálogo. Las claves que no
   * existan simplemente no aparecen en el mapa.
   */
  fraccionesPorClave(tx: Tx, claves: string[]): Promise<Map<string, number>>;

  /**
   * Reserva el siguiente consecutivo de la serie para el tenant activo.
   * Atómico: ver el upsert en el adaptador y el comentario de
   * `folio_contadores` en 0028.
   */
  siguienteFolio(tx: Tx, serie: string, anio: number): Promise<number>;

  crear(tx: Tx, input: CrearRecetaInput, folio: string, anio: number, numero: number): Promise<RecetaView>;

  listarPorPaciente(tx: Tx, patientId: string): Promise<RecetaView[]>;

  findDetalleById(tx: Tx, id: string): Promise<RecetaDetalle | null>;

  /** true si la receta existe en el tenant activo. */
  existe(tx: Tx, id: string): Promise<boolean>;

  /** true si ya está cancelada. */
  estaCancelada(tx: Tx, id: string): Promise<boolean>;

  cancelar(tx: Tx, id: string, canceladoPor: string, motivo: string): Promise<void>;
}

export const RECETA_REPOSITORY = Symbol('RECETA_REPOSITORY');
