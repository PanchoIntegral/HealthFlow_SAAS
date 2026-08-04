import type { ConsentimientoView } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import type { Consentimiento } from './consentimiento.entity';

/**
 * Puerto del repositorio de consentimientos. Insert-only a propósito: no hay
 * `guardar`/`actualizar` porque no existe ningún caso de uso legítimo de
 * modificar un consentimiento ya creado (ver migración 0015).
 */
export interface ConsentimientoRepository {
  crear(tx: Tx, consentimiento: Consentimiento): Promise<ConsentimientoView>;
  listarPorPaciente(tx: Tx, patientId: string): Promise<ConsentimientoView[]>;
}

export const CONSENTIMIENTO_REPOSITORY = Symbol('CONSENTIMIENTO_REPOSITORY');
