import type { TurnoCajaResumen, TurnoCajaView } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import type { TurnoCaja } from './turno-caja.entity';

export const TURNO_CAJA_REPOSITORY = Symbol('TurnoCajaRepository');

/** Rango de fechas ISO (YYYY-MM-DD) para el histórico de cortes. */
export interface RangoCortes {
  desde?: string;
  hasta?: string;
}

/**
 * Puerto de persistencia del turno de caja. Todas las operaciones reciben la
 * transacción con el tenant ya fijado (RLS), igual que el resto de los módulos.
 */
export interface TurnoCajaRepository {
  abrir(tx: Tx, turno: TurnoCaja): Promise<string>;
  /** El turno abierto de la clínica, si lo hay. A lo sumo puede haber uno. */
  findAbierto(tx: Tx): Promise<TurnoCaja | null>;
  findById(tx: Tx, id: string): Promise<TurnoCaja | null>;
  /** Persiste el cierre y los movimientos nuevos o modificados del agregado. */
  guardar(tx: Tx, turno: TurnoCaja): Promise<void>;
  vistaDe(tx: Tx, id: string): Promise<TurnoCajaView | null>;
  /** Histórico de cortes, del más reciente al más viejo. */
  listarTurnos(tx: Tx, rango: RangoCortes): Promise<TurnoCajaResumen[]>;
}
