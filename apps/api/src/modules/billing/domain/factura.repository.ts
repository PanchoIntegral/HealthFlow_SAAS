import type { Tx } from '../../../db/drizzle';
import type { ConceptoCfdi } from './concepto-cfdi.entity';
import type { EmisorFiscal } from './emisor-fiscal.entity';
import type { Factura } from './factura.entity';
import type { ReceptorFiscal } from './receptor-fiscal.entity';

/**
 * Puerto del repositorio de facturación. Corre sobre la transacción con tenant
 * fijado (RLS); además, el adaptador filtra por tenant_id en código — defensa
 * en profundidad, no confiar en una sola capa.
 *
 * Invariante clave: los conceptos de una factura se insertan UNA sola vez
 * (insertPendiente) y nunca se reescriben — updateEstado solo toca los campos
 * de la máquina de estados (estatus, uuid_fiscal, pac_raw_id, error_code,
 * motivo_cancelacion, timestamps).
 */
export interface FacturaRepository {
  /**
   * Inserta la factura PENDIENTE con sus conceptos, atómicamente. Si el índice
   * único parcial (una factura viva por cita) rechaza el insert (23505), lanza
   * FacturaYaEmitidaError — es el candado contra el doble submit concurrente.
   */
  insertPendiente(tx: Tx, factura: Factura, conceptos: ConceptoCfdi[]): Promise<void>;

  findById(tx: Tx, id: string): Promise<Factura | null>;

  /** Factura viva (PENDIENTE o TIMBRADA) de una cita, si existe. */
  findActivaByAppointment(tx: Tx, appointmentId: string): Promise<Factura | null>;

  /** Última factura de la cita en CUALQUIER estatus (para mostrar ERROR/CANCELADA en UI). */
  findUltimaByAppointment(tx: Tx, appointmentId: string): Promise<Factura | null>;

  /** Persiste SOLO los campos de estado de la factura. Nunca toca conceptos. */
  updateEstado(tx: Tx, factura: Factura): Promise<void>;

  listConceptos(tx: Tx, facturaId: string): Promise<ConceptoCfdi[]>;

  /** Emisor fiscal del tenant activo (uno por clínica en el MVP). */
  findEmisorByTenant(tx: Tx): Promise<EmisorFiscal | null>;

  /** Persiste el receptor y devuelve su id. */
  saveReceptor(tx: Tx, receptor: ReceptorFiscal): Promise<string>;
}

export const FACTURA_REPOSITORY = Symbol('FACTURA_REPOSITORY');
