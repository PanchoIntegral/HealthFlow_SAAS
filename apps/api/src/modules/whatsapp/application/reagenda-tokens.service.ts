import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { runInTenant, type Database, type Tx } from '../../../db/drizzle';
import { DB } from '../../../db/drizzle.module';

/**
 * Tokens de un solo uso del enlace de reagendado.
 *
 * El paciente no tiene cuenta en HealthFlow, así que el enlace ES la
 * credencial. Tres decisiones que lo hacen soportable:
 *
 *  - **256 bits de aleatoriedad**, para que adivinarlo no sea una estrategia.
 *  - **En la base solo el SHA-256**, igual que password_reset_tokens (0017): si
 *    alguien se lleva un volcado, no se lleva enlaces válidos de regalo.
 *  - **Caducidad corta y un solo uso**, porque un WhatsApp se queda para
 *    siempre en el historial de un teléfono que puede acabar prestado, vendido
 *    o compartido.
 */

/** Tope de vida del enlace; se acorta si la cita es antes. */
export const HORAS_VIGENCIA = 72;

@Injectable()
export class ReagendaTokensService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Emite un token para esa cita y devuelve el valor EN CLARO, que es lo único
   * que viaja al paciente. Quien llama debe tener el tenant ya resuelto.
   */
  async emitir(
    tx: Tx,
    appointmentId: string,
    inicioCita: Date,
    ahora: Date = new Date(),
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const tope = new Date(ahora.getTime() + HORAS_VIGENCIA * 60 * 60 * 1000);
    // Nunca sobrevive a la propia cita: pasada la hora ya no hay nada que
    // reagendar y el enlace solo sería superficie de ataque.
    const expiresAt = new Date(Math.min(tope.getTime(), inicioCita.getTime()));

    await tx.execute(sql`
      INSERT INTO whatsapp_reagenda_tokens (appointment_id, token_hash, expires_at)
      VALUES (${appointmentId}, ${hash(token)}, ${expiresAt.toISOString()})
    `);
    return token;
  }

  /**
   * Resuelve el token SIN consumirlo, para pintar la página. Cuenta el intento:
   * un token no debe servir de oráculo para sondear citas.
   *
   * Cross-tenant por necesidad —el navegador del paciente no conoce ninguna
   * clínica—, así que va por función SECURITY DEFINER, que devuelve solo
   * identificadores.
   */
  async resolver(token: string): Promise<{ tenantId: string; appointmentId: string } | null> {
    const result = await this.db.execute(
      sql`SELECT status, tenant_id, appointment_id FROM whatsapp_reagenda_resolver(${hash(token)})`,
    );
    return aRuta(result.rows[0]);
  }

  /**
   * Valida y consume en la MISMA llamada: sin ventana entre "leer si sirve" y
   * "marcarlo usado", que es justo por donde se colaría un doble reagendado con
   * dos pestañas abiertas.
   */
  async consumir(token: string): Promise<{ tenantId: string; appointmentId: string } | null> {
    const result = await this.db.execute(
      sql`SELECT status, tenant_id, appointment_id FROM whatsapp_reagenda_consumir(${hash(token)})`,
    );
    return aRuta(result.rows[0]);
  }

  /** Corre `fn` con el tenant que resolvió el token. */
  enTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return runInTenant(this.db, tenantId, fn);
  }
}

function aRuta(fila: unknown): { tenantId: string; appointmentId: string } | null {
  const f = fila as
    | { status: string; tenant_id: string | null; appointment_id: string | null }
    | undefined;
  // 'invalido' y 'expirado' se tratan igual hacia afuera: distinguirlos solo le
  // sirve a quien está probando tokens a ver cuál pega.
  if (!f || f.status !== 'ok' || !f.tenant_id || !f.appointment_id) return null;
  return { tenantId: f.tenant_id, appointmentId: f.appointment_id };
}

export function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
