import type {
  EstatusOrdenPlantillas,
  OrdenPlantillasContent,
  OrdenPlantillasDetalle,
  OrdenPlantillasView,
} from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';

export interface NewOrdenPlantillasInput {
  patientId: string;
  doctorId: string;
  appointmentId: string | null;
}

/**
 * Puerto del repositorio de órdenes de plantillas. El dominio/aplicación
 * dependen de esta abstracción, no de Drizzle. Todos los métodos reciben la
 * transacción con tenant fijado (RLS).
 */
export interface OrdenPlantillasRepository {
  /** Orden asociada a esa cita, o null si aún no se ha abierto el modal en esa consulta. */
  findByAppointment(tx: Tx, appointmentId: string): Promise<OrdenPlantillasView | null>;

  findById(tx: Tx, id: string): Promise<OrdenPlantillasView | null>;

  create(tx: Tx, input: NewOrdenPlantillasInput): Promise<OrdenPlantillasView>;

  saveContent(tx: Tx, id: string, contenido: OrdenPlantillasContent): Promise<void>;

  setEstatus(tx: Tx, id: string, estatus: EstatusOrdenPlantillas): Promise<void>;

  /** Con nombres de paciente/médico/clínica, para la vista de impresión. */
  findDetalleById(tx: Tx, id: string): Promise<OrdenPlantillasDetalle | null>;

  /** Todas las órdenes de un paciente, más reciente primero — para el expediente. */
  listarPorPaciente(tx: Tx, patientId: string): Promise<OrdenPlantillasView[]>;
}

export const ORDEN_PLANTILLAS_REPOSITORY = Symbol('ORDEN_PLANTILLAS_REPOSITORY');
