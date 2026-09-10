import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { createHmac } from 'node:crypto';
import { DB } from '../../db/drizzle.module';
import type { Database } from '../../db/drizzle';
import { env } from '../../config/env';
import { MESSAGING_PROVIDER, type MessagingProvider, type MessageChannel, type MessageKind, type SendResult } from './messaging.types';

interface Claimed { id:string; tenant_id:string; channel:MessageChannel; kind:MessageKind; clinic_name:string; clinic_timezone:string; destination:string|null; appointment_id:string; starts_at:Date|string; attempts:number; idempotency_key:string }

@Injectable()
export class MessagingWorker {
  private readonly logger = new Logger(MessagingWorker.name);
  constructor(@Inject(DB) private readonly db: Database, @Inject(MESSAGING_PROVIDER) private readonly provider: MessagingProvider) {}

  async tick(): Promise<number> {
    const result = await this.db.execute(sql`SELECT * FROM claim_outbound_messages(20)`);
    const rows = result.rows as unknown as Claimed[];
    for (const row of rows) await this.deliver(row);
    return rows.length;
  }

  private async deliver(row: Claimed): Promise<void> {
    if (!row.destination) return this.finish(row.id, { outcome: 'permanent', code: 'missing_destination' });
    // Es el mismo token opaco de 256 bits creado al reservar. Solo su hash
    // vive en PostgreSQL; el worker lo deriva de IDs no públicos + secreto.
    const actionToken = createHmac('sha256', env.publicLinkSecret)
      .update(`${row.tenant_id}.${row.appointment_id}`).digest('base64url');
    let result: SendResult;
    try {
      result = await this.provider.send({
        channel: row.channel, kind: row.kind, destination: row.destination,
        clinicName: row.clinic_name, timezone:row.clinic_timezone, startsAt: new Date(row.starts_at),
        manageUrl: `${env.appUrl}/cita/${actionToken}`,
        idempotencyKey: row.idempotency_key,
        statusCallbackUrl: env.twilioStatusCallbackUrl,
      });
    } catch (error) {
      // Un adaptador que lanza en vez de clasificar no puede garantizar que no envió.
      const code = error instanceof Error ? error.message.slice(0, 80) : 'provider_error';
      result = { outcome: 'uncertain', code };
    }
    if (result.outcome !== 'accepted') this.logger.warn(`Mensaje ${row.id} sin aceptar: ${result.outcome} (${result.code})`);
    await this.finish(row.id, result);
  }

  private async finish(id:string, result:SendResult):Promise<void> {
    const providerId = result.outcome === 'accepted' ? result.providerMessageId : null;
    const code = result.outcome === 'accepted' ? null : result.code;
    await this.db.execute(sql`SELECT complete_outbound_message(${id},${result.outcome},${providerId},${code})`);
  }
}
