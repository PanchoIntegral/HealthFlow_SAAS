import type {
  EstatusPresupuesto,
  PresupuestoView,
  SaldosPorCobrar,
} from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import type { Presupuesto } from './presupuesto.entity';

/**
 * Puerto del repositorio de presupuestos. Todos los métodos reciben la
 * transacción con el tenant fijado, así que RLS garantiza el aislamiento entre
 * clínicas sin que la aplicación tenga que filtrar por tenant_id.
 */
export interface PresupuestoRepository {
  /** Inserta el presupuesto con sus partidas. Devuelve el id. */
  crear(tx: Tx, presupuesto: Presupuesto): Promise<string>;

  /** Reconstruye la entidad completa (partidas y abonos incluidos). */
  findById(tx: Tx, id: string): Promise<Presupuesto | null>;

  /**
   * Persiste el estado completo: estatus, partidas y abonos. Se guarda entero
   * y no por campos porque las reglas de dominio (congelamiento, saldo) razonan
   * sobre el agregado, no sobre filas sueltas.
   */
  guardar(tx: Tx, presupuesto: Presupuesto): Promise<void>;

  /** Vista de lectura con totales ya calculados, para la UI. */
  vistaDe(tx: Tx, id: string): Promise<PresupuestoView | null>;

  /** Presupuestos de un paciente, del más reciente al más viejo. */
  listarPorPaciente(tx: Tx, patientId: string): Promise<PresupuestoView[]>;

  /** Todos los presupuestos del consultorio (para el tablero), opcionalmente filtrados por estatus. */
  listarTodos(tx: Tx, estatus?: EstatusPresupuesto[]): Promise<PresupuestoView[]>;

  /** Saldos vivos del consultorio: aceptados que aún deben dinero. */
  saldosPorCobrar(tx: Tx): Promise<SaldosPorCobrar>;

  /** Presupuesto que contiene partidas terminadas de esa cita, si lo hay. */
  findPorCitaConPartidasTerminadas(tx: Tx, appointmentId: string): Promise<Presupuesto | null>;
}

export const PRESUPUESTO_REPOSITORY = Symbol('PRESUPUESTO_REPOSITORY');
