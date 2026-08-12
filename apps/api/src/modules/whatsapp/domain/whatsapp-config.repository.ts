import type { Tx } from '../../../db/drizzle';
import type { WhatsappConfig } from './whatsapp-config.entity';

export const WHATSAPP_CONFIG_REPOSITORY = Symbol('WHATSAPP_CONFIG_REPOSITORY');

/**
 * Acceso a la configuración de recordatorios. Como todo repo del repo, recibe
 * la transacción: quien decide el alcance (y por tanto el tenant fijado) es el
 * caso de uso, no el adaptador.
 */
export interface WhatsappConfigRepository {
  /** `null` si la clínica nunca ha entrado a la pantalla de recordatorios. */
  find(tx: Tx, tenantId: string): Promise<WhatsappConfig | null>;
  /** Alta o actualización; la fila es una por tenant. */
  save(tx: Tx, config: WhatsappConfig): Promise<void>;
}
