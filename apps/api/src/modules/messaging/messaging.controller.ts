import { BadRequestException, Body, Controller, Get, Headers, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { MessagingDelivery, BookingMetrics } from '@healthflow/shared-types';
import { DB } from '../../db/drizzle.module';
import type { Database } from '../../db/drizzle';
import { TenantDbService } from '../../common/tenant-context/tenant-db.service';
import { env } from '../../config/env';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../auth/casl/policies.guard';

interface WebhookRequest { headers: Record<string,string|string[]|undefined>; body: Record<string,unknown>; }

@Controller('webhooks')
export class MessagingWebhookController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Post('twilio/status')
  async twilio(@Req() req: RawBodyRequest<WebhookRequest>, @Body() body: Record<string,string>):Promise<{received:true}> {
    const signature=req.headers['x-twilio-signature'];
    if(typeof signature!=='string'||!this.validTwilio(signature,body)) throw new BadRequestException('Firma de Twilio inválida');
    const sid=body.MessageSid; const status=body.MessageStatus;
    if(!sid||!status) throw new BadRequestException('Evento incompleto');
    await this.db.execute(sql`SELECT process_messaging_status('twilio',${`${sid}:${status}`},${sid},${status})`);
    return {received:true};
  }

  @Post('resend')
  async resend(@Req() req: RawBodyRequest<WebhookRequest>, @Body() body: {type?:string;data?:{email_id?:string}}):Promise<{received:true}> {
    if(!req.rawBody||!this.validResend(req.headers,req.rawBody)) throw new BadRequestException('Firma de Resend inválida');
    const id=req.headers['svix-id']; const messageId=body.data?.email_id;
    if(typeof id!=='string'||!messageId||!body.type) throw new BadRequestException('Evento incompleto');
    const status=body.type.replace(/^email\./,'');
    await this.db.execute(sql`SELECT process_messaging_status('resend',${id},${messageId},${status})`);
    return {received:true};
  }

  private validTwilio(signature:string, body:Record<string,string>):boolean {
    const data=env.twilioStatusCallbackUrl+Object.keys(body).sort().map(k=>`${k}${body[k]}`).join('');
    const expected=createHmac('sha1',env.twilioAuthToken).update(data).digest('base64');
    return safeEqual(signature,expected);
  }

  private validResend(headers:Record<string,string|string[]|undefined>,raw:Buffer):boolean {
    const id=headers['svix-id'], timestamp=headers['svix-timestamp'], signature=headers['svix-signature'];
    if(typeof id!=='string'||typeof timestamp!=='string'||typeof signature!=='string') return false;
    if(Math.abs(Date.now()/1000-Number(timestamp))>300) return false;
    const secret=env.resendWebhookSecret.replace(/^whsec_/,'');
    let key:Buffer; try { key=Buffer.from(secret,'base64'); } catch { return false; }
    const expected=createHmac('sha256',key).update(`${id}.${timestamp}.${raw.toString('utf8')}`).digest('base64');
    return signature.split(' ').some(part=>safeEqual(part.replace(/^v\d+,/,''),expected));
  }
}

@Controller('messaging')
@UseGuards(JwtAuthGuard,PoliciesGuard)
export class MessagingAdminController {
  constructor(private readonly tenantDb:TenantDbService){}

  @Get('deliveries') @RequirePolicy('manage','all')
  async deliveries():Promise<MessagingDelivery[]> {
    return this.tenantDb.run(async tx => {
      const r=await tx.execute(sql`SELECT id,appointment_id,channel,kind,status,scheduled_at,attempts,last_error_code FROM outbound_messages ORDER BY created_at DESC LIMIT 200`);
      return (r.rows as any[]).map(x=>({id:x.id,appointmentId:x.appointment_id,channel:x.channel,kind:x.kind,status:x.status,scheduledAt:new Date(x.scheduled_at).toISOString(),attempts:x.attempts,lastErrorCode:x.last_error_code}));
    });
  }

  @Post('deliveries/:id/retry') @RequirePolicy('manage','all')
  async retry(@Param('id') id:string):Promise<{ok:true}> {
    await this.tenantDb.run(tx=>tx.execute(sql`UPDATE outbound_messages SET status='pending',next_attempt_at=now(),locked_at=NULL,updated_at=now() WHERE id=${id} AND status IN ('failed','dead')`));
    return {ok:true};
  }

  @Get('metrics') @RequirePolicy('manage','all')
  async metrics():Promise<BookingMetrics> {
    return this.tenantDb.run(async tx=>{
      const r=await tx.execute(sql`SELECT
        count(DISTINCT appointment_id) FILTER (WHERE event='scheduled' AND appointment_id IN (SELECT id FROM appointments WHERE origen='publico'))::int public_bookings,
        count(*) FILTER (WHERE event='delivered')::int delivered,
        count(*) FILTER (WHERE event='confirmed')::int confirmed,
        count(*) FILTER (WHERE event='cancelled')::int cancelled,
        count(*) FILTER (WHERE event='rescheduled')::int rescheduled,
        (SELECT count(*)::int FROM appointments WHERE estatus='no_asistio') no_shows
        FROM messaging_events WHERE created_at >= date_trunc('month',now())`);
      const x=r.rows[0] as any; return {publicBookings:x.public_bookings,delivered:x.delivered,confirmed:x.confirmed,cancelled:x.cancelled,rescheduled:x.rescheduled,noShows:x.no_shows};
    });
  }
}

function safeEqual(a:string,b:string):boolean { const x=Buffer.from(a),y=Buffer.from(b); return x.length===y.length&&timingSafeEqual(x,y); }
