import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
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
import { AuditService } from '../../common/audit/audit.service';

/** Conserva sólo claves conocidas y valores cortos; descarta todo lo demás. */
export function sanitizeWebhookPayload(input:Record<string,unknown>):Record<string,string> {
  const out:Record<string,string>={};
  for(const key of ['errorCode','type'] as const){
    const v=input[key]; if(v===undefined||v===null||v==='') continue;
    out[key]=String(v).slice(0,40);
  }
  return out;
}

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
    // Payload mínimo: sólo el código de error. Nunca To/From ni cuerpo.
    const payload=sanitizeWebhookPayload({errorCode:body.ErrorCode});
    await this.db.execute(sql`SELECT process_messaging_status('twilio',${`${sid}:${status}`},${sid},${status},${JSON.stringify(payload)}::jsonb)`);
    return {received:true};
  }

  @Post('resend')
  async resend(@Req() req: RawBodyRequest<WebhookRequest>, @Body() body: {type?:string;data?:{email_id?:string}}):Promise<{received:true}> {
    if(!req.rawBody||!this.validResend(req.headers,req.rawBody)) throw new BadRequestException('Firma de Resend inválida');
    const id=req.headers['svix-id']; const messageId=body.data?.email_id;
    if(typeof id!=='string'||!messageId||!body.type) throw new BadRequestException('Evento incompleto');
    const status=body.type.replace(/^email\./,'');
    const payload=sanitizeWebhookPayload({type:body.type});
    await this.db.execute(sql`SELECT process_messaging_status('resend',${id},${messageId},${status},${JSON.stringify(payload)}::jsonb)`);
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
  constructor(private readonly tenantDb:TenantDbService,private readonly audit:AuditService){}

  @Get('deliveries') @RequirePolicy('manage','all')
  async deliveries():Promise<MessagingDelivery[]> {
    return this.tenantDb.run(async tx => {
      const r=await tx.execute(sql`SELECT id,appointment_id,recall_attempt_id,channel,kind,status,scheduled_at,attempts,last_error_code FROM outbound_messages ORDER BY created_at DESC LIMIT 200`);
      return (r.rows as any[]).map(x=>({id:x.id,appointmentId:x.appointment_id,recallAttemptId:x.recall_attempt_id,channel:x.channel,kind:x.kind,status:x.status,scheduledAt:new Date(x.scheduled_at).toISOString(),attempts:x.attempts,lastErrorCode:x.last_error_code}));
    });
  }

  /**
   * Reintento manual. `failed`/`dead` se reintentan sin más. `uncertain`
   * exige `confirmResend`: el administrador acepta el riesgo de duplicado
   * porque verificó en el proveedor que el mensaje no salió.
   */
  @Post('deliveries/:id/retry') @RequirePolicy('manage','all')
  async retry(@Param('id') id:string,@Body() body:{confirmResend?:boolean}|undefined):Promise<{ok:true}> {
    await this.tenantDb.run(async tx=>{
      const row=(await tx.execute(sql`SELECT status FROM outbound_messages WHERE id=${id}`)).rows[0] as {status:string}|undefined;
      if(!row) throw new NotFoundException('Mensaje no encontrado');
      if(row.status==='uncertain'&&!body?.confirmResend) throw new ConflictException('Este mensaje pudo haberse enviado; confirma el reenvío explícitamente');
      if(!['failed','dead','uncertain'].includes(row.status)) throw new ConflictException('El mensaje no admite reintento');
      await tx.execute(sql`UPDATE outbound_messages SET status='pending',next_attempt_at=now(),locked_at=NULL,last_error_code=NULL,updated_at=now() WHERE id=${id}`);
      await this.audit.record(tx,{entidad:'outbound_message',entidadId:id,accion:'manual_retry',detalle:{previousStatus:row.status}});
    });
    return {ok:true};
  }

  /** El administrador verificó en el proveedor que el mensaje sí salió: se cierra como enviado sin reenviar. */
  @Post('deliveries/:id/mark-sent') @RequirePolicy('manage','all')
  async markSent(@Param('id') id:string):Promise<{ok:true}> {
    await this.tenantDb.run(async tx=>{
      const row=(await tx.execute(sql`SELECT status,tenant_id,appointment_id FROM outbound_messages WHERE id=${id}`)).rows[0] as {status:string;tenant_id:string;appointment_id:string|null}|undefined;
      if(!row) throw new NotFoundException('Mensaje no encontrado');
      if(row.status!=='uncertain') throw new ConflictException('Sólo un mensaje incierto puede marcarse como enviado');
      await tx.execute(sql`UPDATE outbound_messages SET status='sent',last_error_code=NULL,updated_at=now() WHERE id=${id}`);
      await tx.execute(sql`INSERT INTO messaging_events(appointment_id,message_id,event) VALUES(${row.appointment_id},${id},'resolved')`);
      await this.audit.record(tx,{entidad:'outbound_message',entidadId:id,accion:'mark_sent',detalle:{previousStatus:'uncertain'}});
    });
    return {ok:true};
  }

  @Get('metrics') @RequirePolicy('manage','all')
  async metrics(@Query('from') fromRaw?:string,@Query('to') toRaw?:string):Promise<BookingMetrics> {
    const {from,to}=metricsPeriod(fromRaw,toRaw);
    return this.tenantDb.run(async tx=>{
      // Las citas son la fuente del embudo. Así también se cuenta a quien
      // eligió "Sin avisos" y cada cita aparece una sola vez.
      const appointments=await tx.execute(sql`SELECT
        count(*)::int public_bookings,
        count(*) FILTER (WHERE estado_confirmacion='confirmada')::int confirmed,
        count(*) FILTER (WHERE estatus='cancelada')::int cancelled,
        count(*) FILTER (WHERE messaging_version>1)::int rescheduled,
        count(*) FILTER (WHERE estatus='no_asistio')::int no_shows
        FROM appointments
        WHERE origen='publico' AND inicio_programado>=${from.toISOString()} AND inicio_programado<${to.toISOString()}`);
      // La entrega pertenece al subsistema de mensajes, con exactamente el
      // mismo periodo y sólo para citas del embudo público.
      const messages=await tx.execute(sql`SELECT count(*) FILTER (WHERE om.status='delivered')::int delivered
        FROM outbound_messages om JOIN appointments a ON a.id=om.appointment_id
        WHERE a.origen='publico' AND om.scheduled_at>=${from.toISOString()} AND om.scheduled_at<${to.toISOString()}`);
      const a=appointments.rows[0] as any,m=messages.rows[0] as any;
      return {publicBookings:a.public_bookings,delivered:m.delivered,confirmed:a.confirmed,cancelled:a.cancelled,rescheduled:a.rescheduled,noShows:a.no_shows};
    });
  }
}

function safeEqual(a:string,b:string):boolean { const x=Buffer.from(a),y=Buffer.from(b); return x.length===y.length&&timingSafeEqual(x,y); }

export function metricsPeriod(fromRaw?:string,toRaw?:string,now=new Date()):{from:Date;to:Date}{
  const to=toRaw?new Date(toRaw):now;
  const from=fromRaw?new Date(fromRaw):new Date(to.getTime()-30*86_400_000);
  if(!Number.isFinite(from.getTime())||!Number.isFinite(to.getTime())) throw new BadRequestException('Periodo de métricas inválido');
  if(from>=to) throw new BadRequestException('La fecha inicial debe ser anterior a la final');
  if(to.getTime()-from.getTime()>366*86_400_000) throw new BadRequestException('El periodo máximo es de 366 días');
  return {from,to};
}
