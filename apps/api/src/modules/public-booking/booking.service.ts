import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID, createHmac } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { AvailabilitySlot, BookingService, BookingSettings, CreatePublicAppointmentRequest, PublicAppointmentSummary, PublicBookingPage, BookingReadiness, PublicDirectoryPage, PublicDirectorySpecialty } from '@healthflow/shared-types';
import { DB } from '../../db/drizzle.module';
import { runInTenant, type Database, type Tx } from '../../db/drizzle';
import { TenantDbService } from '../../common/tenant-context/tenant-db.service';
import { env } from '../../config/env';
import { OutboxService } from '../messaging/outbox.service';
import type { AvailabilityExceptionDto, AvailabilityRuleDto, UpdateBookingSettingsDto, UpsertBookingServiceDto } from './booking.dto';

type SettingsRow={tenant_id:string;slug:string;publicado:boolean;directorio_publico:boolean;feature_activa:boolean;timezone:string;anticipacion_minima_horas:number;horizonte_dias:number;limite_cancelacion_horas:number;recordatorios_horas:number[];aviso_privacidad_version:string};
type DirectoryRow={slug:string;clinic_name:string;clinic_address:string|null;doctor_id:string;doctor_name:string;specialty:string|null;total_count:string|number};
type SpecialtyRow={specialty:string;total:string|number};
type ReadinessRow={publicado:boolean;directorio_publico:boolean;feature_activa:boolean;plan:string;subscription_status:string;grace_until:string|null;servicios:string|number;medicos:string|number};

/** Debe coincidir con el filtro de plan de `resolve_public_booking_tenant` (0035). */
const PLANES_CON_RESERVA=['consultorio','clinica','pro'];

@Injectable()
export class BookingServiceApp {
  constructor(@Inject(DB) private readonly db:Database,private readonly tenantDb:TenantDbService,private readonly outbox:OutboxService){}

  async directory(query:string|undefined,specialty:string|undefined,page:number,pageSize:number):Promise<PublicDirectoryPage>{
    const safePage=Math.max(1,page),safePageSize=Math.max(1,Math.min(pageSize,24)),offset=(safePage-1)*safePageSize;
    const rows=(await this.db.execute(sql`SELECT * FROM search_public_booking_directory(${query?.trim()??''},${specialty?.trim()||null},${safePageSize},${offset})`)).rows as DirectoryRow[];
    return {items:rows.map(x=>({clinicName:x.clinic_name,clinicAddress:x.clinic_address,slug:x.slug,doctorId:x.doctor_id,doctorName:x.doctor_name,specialty:x.specialty})),total:Number(rows[0]?.total_count??0),page:safePage,pageSize:safePageSize};
  }

  /** Catálogo completo de especialidades publicadas; alimenta el filtro de la landing. */
  async directorySpecialties():Promise<PublicDirectorySpecialty[]>{
    const rows=(await this.db.execute(sql`SELECT * FROM list_public_booking_specialties()`)).rows as SpecialtyRow[];
    return rows.map(x=>({specialty:x.specialty,total:Number(x.total)}));
  }

  async publicPage(slug:string):Promise<PublicBookingPage>{
    const tenant=await this.resolveSlug(slug); if(!tenant) throw new NotFoundException('Página de reservas no disponible');
    return runInTenant(this.db,tenant,async tx=>{
      const s=await this.settingsRow(tx); if(!s) throw new NotFoundException();
      const clinic=(await tx.execute(sql`SELECT nombre_clinica FROM tenants LIMIT 1`)).rows[0] as {nombre_clinica:string};
      const services=await this.listServicesTx(tx,true);
      const d=await tx.execute(sql`SELECT DISTINCT u.id,u.nombre,u.especialidad FROM users u JOIN booking_service_doctors bsd ON bsd.doctor_id=u.id JOIN booking_services bs ON bs.id=bsd.service_id WHERE u.activo AND bs.activo AND bs.publico ORDER BY u.nombre`);
      return {clinicName:clinic.nombre_clinica,timezone:s.timezone,minNoticeHours:s.anticipacion_minima_horas,horizonDays:s.horizonte_dias,privacyNoticeVersion:s.aviso_privacidad_version,services,doctors:d.rows as any};
    });
  }

  async availability(slug:string,serviceId:string,doctorId:string|undefined,from:string,to:string):Promise<AvailabilitySlot[]>{
    const tenant=await this.resolveSlug(slug); if(!tenant) throw new NotFoundException('Página de reservas no disponible');
    const start=new Date(from),end=new Date(to); if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start||end.getTime()-start.getTime()>7*86400000) throw new BadRequestException('El rango debe ser válido y de máximo siete días');
    return runInTenant(this.db,tenant,async tx=>{
      const r=await tx.execute(sql`
        WITH cfg AS (SELECT * FROM booking_settings LIMIT 1), svc AS
          (SELECT * FROM booking_services WHERE id=${serviceId} AND activo AND publico),
        eligible AS (SELECT u.id,u.nombre FROM users u JOIN booking_service_doctors x ON x.doctor_id=u.id JOIN svc ON svc.id=x.service_id WHERE u.activo ${doctorId?sql`AND u.id=${doctorId}`:sql``}),
        days AS (SELECT d::date day FROM cfg CROSS JOIN LATERAL generate_series((${start.toISOString()}::timestamptz AT TIME ZONE cfg.timezone)::date,(${end.toISOString()}::timestamptz AT TIME ZONE cfg.timezone)::date,interval '1 day') d),
        windows AS (SELECT e.id doctor_id,e.nombre doctor_name,d.day,a.inicio_local,a.fin_local,svc.duracion_minutos,cfg.timezone FROM eligible e CROSS JOIN days d JOIN doctor_availability a ON a.doctor_id=e.id AND a.weekday=extract(dow FROM d.day) CROSS JOIN svc CROSS JOIN cfg),
        slots AS (SELECT w.*,g AS starts_at,g+(w.duracion_minutos||' minutes')::interval AS ends_at FROM windows w CROSS JOIN LATERAL generate_series((w.day+w.inicio_local) AT TIME ZONE w.timezone,((w.day+w.fin_local) AT TIME ZONE w.timezone)-(w.duracion_minutos||' minutes')::interval,(w.duracion_minutos||' minutes')::interval) g)
        SELECT starts_at,ends_at,doctor_id,doctor_name FROM slots s
         WHERE starts_at>=greatest(${start.toISOString()}::timestamptz,now()+(SELECT anticipacion_minima_horas FROM cfg)*interval '1 hour')
           AND starts_at<${end.toISOString()}::timestamptz
           AND starts_at<now()+(SELECT horizonte_dias FROM cfg)*interval '1 day'
           AND NOT EXISTS(SELECT 1 FROM availability_exceptions e WHERE e.doctor_id=s.doctor_id AND e.fecha=s.day AND NOT e.disponible AND (e.inicio_local IS NULL OR tstzrange(starts_at,ends_at,'[)') && tstzrange((s.day+e.inicio_local) AT TIME ZONE s.timezone,(s.day+e.fin_local) AT TIME ZONE s.timezone,'[)')))
           AND NOT EXISTS(SELECT 1 FROM appointments a WHERE a.doctor_id=s.doctor_id AND a.estatus NOT IN ('cancelada','no_asistio') AND tstzrange(a.inicio_programado,a.fin_programado,'[)') && tstzrange(starts_at,ends_at,'[)'))
         ORDER BY starts_at,doctor_name
      `);
      return (r.rows as any[]).map(x=>({start:new Date(x.starts_at).toISOString(),end:new Date(x.ends_at).toISOString(),doctorId:x.doctor_id,doctorName:x.doctor_name}));
    });
  }

  async create(slug:string,input:CreatePublicAppointmentRequest):Promise<PublicAppointmentSummary>{
    const tenant=await this.resolveSlug(slug); if(!tenant) throw new NotFoundException('Página de reservas no disponible');
    const start=new Date(input.start); if(!Number.isFinite(start.getTime())) throw new BadRequestException('Horario inválido');
    try { return await runInTenant(this.db,tenant,async tx=>{
      const cfg=await this.settingsRow(tx); if(!cfg||input.patient.privacyNoticeVersion!==cfg.aviso_privacidad_version) throw new BadRequestException('Debes aceptar la versión vigente del aviso de privacidad');
      const svc=(await tx.execute(sql`SELECT id,duracion_minutos FROM booking_services WHERE id=${input.serviceId} AND activo AND publico LIMIT 1`)).rows[0] as {id:string;duracion_minutos:number}|undefined;
      if(!svc) throw new NotFoundException('Servicio no disponible'); const end=new Date(start.getTime()+svc.duracion_minutos*60000);
      const slots=await this.availabilityForTx(tx,input.serviceId,input.doctorId,start,end); if(!slots.length) throw new ConflictException('El horario ya no está disponible');
      const chosen=slots[0]!; const phone=normalizePhone(input.patient.telefono); if(!phone) throw new BadRequestException('Teléfono inválido');
      const birth=new Date(`${input.patient.fechaNacimiento}T00:00:00Z`);if(!Number.isFinite(birth.getTime())||birth.getTime()>Date.now())throw new BadRequestException('Fecha de nacimiento inválida');
      const normalizedName=normalizeName(input.patient.nombre);
      let patient=(await tx.execute(sql`SELECT id FROM patients WHERE archivado_en IS NULL AND lower(regexp_replace(nombre,'\\s+',' ','g'))=${normalizedName} AND fecha_nacimiento=${input.patient.fechaNacimiento} AND telefono_normalizado=${phone} LIMIT 1`)).rows[0] as {id:string}|undefined;
      if(!patient){
        const duplicate=(await tx.execute(sql`SELECT 1 FROM patients WHERE archivado_en IS NULL AND (telefono_normalizado=${phone} OR (lower(regexp_replace(nombre,'\\s+',' ','g'))=${normalizedName} AND fecha_nacimiento=${input.patient.fechaNacimiento})) LIMIT 1`)).rows.length>0;
        patient=(await tx.execute(sql`INSERT INTO patients(tenant_id,nombre,fecha_nacimiento,telefono,telefono_normalizado,email,canal_preferido,whatsapp_opt_in_at,aviso_privacidad_version,aviso_privacidad_aceptado_at,posible_duplicado) VALUES(current_tenant_id(),${input.patient.nombre.trim()},${input.patient.fechaNacimiento},${input.patient.telefono},${phone},${input.patient.email?.toLowerCase()??null},${input.patient.canalPreferido},${input.patient.whatsappOptIn?new Date().toISOString():null},${cfg.aviso_privacidad_version},now(),${duplicate}) RETURNING id`)).rows[0] as {id:string};
      }
      await tx.execute(sql`UPDATE patients SET telefono=${input.patient.telefono},telefono_normalizado=${phone},email=coalesce(${input.patient.email?.toLowerCase()??null},email),canal_preferido=${input.patient.canalPreferido},whatsapp_opt_in_at=${input.patient.whatsappOptIn?new Date().toISOString():null},aviso_privacidad_version=${cfg.aviso_privacidad_version},aviso_privacidad_aceptado_at=now() WHERE id=${patient.id}`);
      const appointmentId=randomUUID();
      const token=createHmac('sha256',env.publicLinkSecret).update(`${tenant}.${appointmentId}`).digest('base64url'),hash=hashToken(token);
      const appointment=(await tx.execute(sql`INSERT INTO appointments(id,tenant_id,patient_id,doctor_id,service_id,motivo,inicio_programado,fin_programado,estatus,origen,estado_confirmacion,public_manage_token_hash,manage_token_expires_at) VALUES(${appointmentId},current_tenant_id(),${patient.id},${chosen.doctorId},${input.serviceId},NULL,${start.toISOString()},${end.toISOString()},'agendada','publico','pendiente',${hash},${new Date(end.getTime()+86400000).toISOString()}) RETURNING id`)).rows[0] as {id:string};
      await tx.execute(sql`INSERT INTO audit_log(tenant_id,user_id,entidad,entidad_id,accion,detalle) VALUES(current_tenant_id(),NULL,'appointment',${appointment.id},'public_schedule',jsonb_build_object('doctorId',${chosen.doctorId},'serviceId',${input.serviceId}))`);
      await this.outbox.schedule(tx,{appointmentId:appointment.id,patientId:patient.id,startsAt:start,email:input.patient.email?.toLowerCase()??null,phone,whatsappOptIn:input.patient.whatsappOptIn,preferredChannel:input.patient.canalPreferido,reminderHours:cfg.recordatorios_horas});
      const clinic=(await tx.execute(sql`SELECT nombre_clinica FROM tenants LIMIT 1`)).rows[0] as {nombre_clinica:string};
      return {clinicName:clinic.nombre_clinica,doctorName:chosen.doctorName,start:start.toISOString(),end:end.toISOString(),status:'agendada',confirmationStatus:'pendiente',manageUrl:`${env.appUrl}/cita/${token}`};
    }); } catch(error){ if(isExclusion(error)) throw new ConflictException('El horario acaba de ocuparse; consulta la disponibilidad actualizada'); throw error; }
  }

  async getAppointment(token:string):Promise<PublicAppointmentSummary>{ return this.withToken(token,(tx,hash)=>this.summary(tx,hash)); }

  async confirm(token:string):Promise<PublicAppointmentSummary>{ return this.withToken(token,async(tx,hash)=>{ const row=await this.getAppointmentRow(tx,hash); if(row.estatus==='cancelada') throw new ConflictException('La cita está cancelada'); await tx.execute(sql`UPDATE appointments SET estado_confirmacion='confirmada' WHERE id=${row.id}`); await this.event(tx,row.id,'confirmed'); return this.summary(tx,hash); }); }

  async cancel(token:string):Promise<PublicAppointmentSummary>{ return this.withToken(token,async(tx,hash)=>{ const row=await this.getAppointmentRow(tx,hash); const cfg=await this.settingsRow(tx); if(startTooSoon(row.inicio_programado,cfg?.limite_cancelacion_horas??0)) throw new ForbiddenException('La cita ya está dentro del límite de cancelación; comunícate con la clínica'); if(row.estatus!=='cancelada'){ await this.outbox.cancelPending(tx,row.id); await tx.execute(sql`UPDATE appointments SET estatus='cancelada',estado_confirmacion='cancelada' WHERE id=${row.id}`); await this.outbox.schedule(tx,{appointmentId:row.id,patientId:row.patient_id,startsAt:new Date(row.inicio_programado),email:row.email,phone:row.telefono_normalizado,whatsappOptIn:!!row.whatsapp_opt_in_at,preferredChannel:row.canal_preferido,reminderHours:[],kind:'cancelled'}); await this.event(tx,row.id,'cancelled'); } return this.summary(tx,hash); }); }

  async reschedule(token:string,startIso:string,doctorId?:string):Promise<PublicAppointmentSummary>{
    const start=new Date(startIso); if(!Number.isFinite(start.getTime())) throw new BadRequestException('Horario inválido');
    try{return await this.withToken(token,async(tx,hash)=>{ const row=await this.getAppointmentRow(tx,hash); const cfg=await this.settingsRow(tx); if(startTooSoon(row.inicio_programado,cfg?.limite_cancelacion_horas??0)) throw new ForbiddenException('La cita ya está dentro del límite de reprogramación'); const end=new Date(start.getTime()+row.duracion_minutos*60000); const slots=await this.availabilityForTx(tx,row.service_id,doctorId,start,end,row.id); if(!slots.length) throw new ConflictException('Horario no disponible'); const chosen=slots[0]!; await this.outbox.cancelPending(tx,row.id); await tx.execute(sql`UPDATE appointments SET doctor_id=${chosen.doctorId},inicio_programado=${start.toISOString()},fin_programado=${end.toISOString()},estado_confirmacion='pendiente' WHERE id=${row.id}`); await this.outbox.schedule(tx,{appointmentId:row.id,patientId:row.patient_id,startsAt:start,email:row.email,phone:row.telefono_normalizado,whatsappOptIn:!!row.whatsapp_opt_in_at,preferredChannel:row.canal_preferido,reminderHours:cfg?.recordatorios_horas??[48,24],kind:'rescheduled'}); await this.event(tx,row.id,'rescheduled'); return this.summary(tx,hash);});}catch(error){if(isExclusion(error))throw new ConflictException('El horario acaba de ocuparse');throw error;}
  }

  async getSettings():Promise<BookingSettings>{return this.tenantDb.run(async tx=>{let s=await this.settingsRow(tx);if(!s){const name=((await tx.execute(sql`SELECT nombre_clinica FROM tenants LIMIT 1`)).rows[0] as any).nombre_clinica;s=(await tx.execute(sql`INSERT INTO booking_settings(slug) VALUES(${slugify(name)+'-'+randomBytes(3).toString('hex')}) RETURNING *`)).rows[0] as SettingsRow;}return mapSettings(s);});}
  async updateSettings(input:UpdateBookingSettingsDto):Promise<BookingSettings>{validateTimezone(input.timezone);
    // drizzle expande un arreglo de JS en una lista de parámetros —`($9,$10)`,
    // que Postgres lee como record y rechaza contra una columna integer[]—, así
    // que se manda como literal de arreglo en UN parámetro y se castea. El DTO
    // ya valida que sean enteros; el Number() evita que la seguridad de la
    // consulta dependa de esa validación.
    const recordatorios=`{${input.recordatoriosHoras.map(Number).join(',')}}`;
    return this.tenantDb.run(async tx=>{const r=await tx.execute(sql`INSERT INTO booking_settings(slug,publicado,directorio_publico,feature_activa,timezone,anticipacion_minima_horas,horizonte_dias,limite_cancelacion_horas,recordatorios_horas,aviso_privacidad_version) VALUES(${input.slug.toLowerCase()},${input.publicado},${input.directorioPublico},${input.featureActiva},${input.timezone},${input.anticipacionMinimaHoras},${input.horizonteDias},${input.limiteCancelacionHoras},${recordatorios}::int[],${input.avisoPrivacidadVersion}) ON CONFLICT(tenant_id) DO UPDATE SET slug=excluded.slug,publicado=excluded.publicado,directorio_publico=excluded.directorio_publico,feature_activa=excluded.feature_activa,timezone=excluded.timezone,anticipacion_minima_horas=excluded.anticipacion_minima_horas,horizonte_dias=excluded.horizonte_dias,limite_cancelacion_horas=excluded.limite_cancelacion_horas,recordatorios_horas=excluded.recordatorios_horas,aviso_privacidad_version=excluded.aviso_privacidad_version,updated_at=now() RETURNING *`);return mapSettings(r.rows[0] as SettingsRow);});}
  /**
   * Evalúa los mismos requisitos que las funciones SQL de la superficie
   * pública, pero devolviendo cada uno por separado. Se consulta dentro del
   * tenant, así que RLS sigue aplicando: una clínica sólo se diagnostica a sí
   * misma.
   */
  async readiness():Promise<BookingReadiness>{
    return this.tenantDb.run(async tx=>{
      const r=(await tx.execute(sql`
        SELECT bs.publicado, bs.directorio_publico, bs.feature_activa,
               t.plan, t.subscription_status, t.grace_until,
               (SELECT count(*) FROM booking_services svc
                 WHERE svc.activo AND svc.publico) AS servicios,
               (SELECT count(DISTINCT u.id) FROM booking_services svc
                  JOIN booking_service_doctors bsd ON bsd.service_id = svc.id
                  JOIN users u ON u.id = bsd.doctor_id AND u.activo
                 WHERE svc.activo AND svc.publico) AS medicos
          FROM booking_settings bs JOIN tenants t ON t.id = bs.tenant_id
         LIMIT 1`)).rows[0] as ReadinessRow|undefined;
      if(!r) throw new NotFoundException('La clínica todavía no tiene ajustes de reservas');
      const grace=r.grace_until?new Date(r.grace_until):null;
      return {
        publicada:r.publicado,
        featureActiva:r.feature_activa,
        directorioPublico:r.directorio_publico,
        planPermitido:PLANES_CON_RESERVA.includes(r.plan),
        plan:r.plan,
        suscripcionVigente:['active','trialing'].includes(r.subscription_status)
          ||(r.subscription_status==='past_due'&&!!grace&&grace>new Date()),
        suscripcionEstatus:r.subscription_status,
        serviciosPublicos:Number(r.servicios),
        medicosPublicables:Number(r.medicos),
      };
    });
  }

  async listServices():Promise<BookingService[]>{return this.tenantDb.run(tx=>this.listServicesTx(tx,false));}
  async createService(i:UpsertBookingServiceDto):Promise<BookingService>{return this.tenantDb.run(async tx=>{const id=((await tx.execute(sql`INSERT INTO booking_services(nombre,duracion_minutos,precio_centavos,publico,activo,orden) VALUES(${i.nombre.trim()},${i.duracionMinutos},${i.precioCentavos??null},${i.publico},${i.activo},${i.orden}) RETURNING id`)).rows[0] as any).id;await this.assignDoctors(tx,id,i.doctorIds);return (await this.listServicesTx(tx,false)).find(x=>x.id===id)!;});}
  async updateService(id:string,i:UpsertBookingServiceDto):Promise<BookingService>{return this.tenantDb.run(async tx=>{const r=await tx.execute(sql`UPDATE booking_services SET nombre=${i.nombre.trim()},duracion_minutos=${i.duracionMinutos},precio_centavos=${i.precioCentavos??null},publico=${i.publico},activo=${i.activo},orden=${i.orden} WHERE id=${id} RETURNING id`);if(!r.rows.length)throw new NotFoundException();await this.assignDoctors(tx,id,i.doctorIds);return (await this.listServicesTx(tx,false)).find(x=>x.id===id)!;});}
  async replaceAvailability(doctorId:string,rules:AvailabilityRuleDto[]):Promise<void>{await this.tenantDb.run(async tx=>{await tx.execute(sql`DELETE FROM doctor_availability WHERE doctor_id=${doctorId}`);for(const x of rules)await tx.execute(sql`INSERT INTO doctor_availability(doctor_id,weekday,inicio_local,fin_local) VALUES(${doctorId},${x.weekday},${x.inicioLocal},${x.finLocal})`);});}
  async listAvailabilityRules():Promise<any[]>{return this.tenantDb.run(async tx=>(await tx.execute(sql`SELECT doctor_id,weekday,to_char(inicio_local,'HH24:MI') inicio_local,to_char(fin_local,'HH24:MI') fin_local FROM doctor_availability ORDER BY doctor_id,weekday,inicio_local`)).rows as any[]);}
  async addException(i:AvailabilityExceptionDto):Promise<any>{return this.tenantDb.run(async tx=>(await tx.execute(sql`INSERT INTO availability_exceptions(doctor_id,fecha,inicio_local,fin_local,disponible,nota) VALUES(${i.doctorId},${i.fecha},${i.inicioLocal??null},${i.finLocal??null},${i.disponible},${i.nota??null}) RETURNING id`)).rows[0]);}

  private async resolveSlug(slug:string):Promise<string|null>{const r=await this.db.execute(sql`SELECT resolve_public_booking_tenant(${slug.toLowerCase()}) tenant_id`);return ((r.rows[0] as any)?.tenant_id as string|null)??null;}
  private async withToken<T>(token:string,fn:(tx:Tx,hash:string)=>Promise<T>):Promise<T>{if(!/^[A-Za-z0-9_-]{40,60}$/.test(token))throw new NotFoundException('Cita no encontrada');const hash=hashToken(token),r=await this.db.execute(sql`SELECT resolve_public_appointment_tenant(${hash}) tenant_id`),tenant=(r.rows[0] as any)?.tenant_id;if(!tenant)throw new NotFoundException('Cita no encontrada');return runInTenant(this.db,tenant,(tx)=>fn(tx,hash));}
  private async settingsRow(tx:Tx):Promise<SettingsRow|undefined>{return (await tx.execute(sql`SELECT * FROM booking_settings LIMIT 1`)).rows[0] as SettingsRow|undefined;}
  private async listServicesTx(tx:Tx,onlyPublic:boolean):Promise<BookingService[]>{const r=await tx.execute(sql`SELECT s.*,coalesce(array_agg(x.doctor_id) FILTER(WHERE x.doctor_id IS NOT NULL),'{}') doctor_ids FROM booking_services s LEFT JOIN booking_service_doctors x ON x.service_id=s.id ${onlyPublic?sql`WHERE s.activo AND s.publico`:sql``} GROUP BY s.id ORDER BY s.orden,s.nombre`);return (r.rows as any[]).map(x=>({id:x.id,nombre:x.nombre,duracionMinutos:x.duracion_minutos,precioCentavos:x.precio_centavos,publico:x.publico,activo:x.activo,orden:x.orden,doctorIds:x.doctor_ids}));}
  private async assignDoctors(tx:Tx,serviceId:string,ids:string[]):Promise<void>{await tx.execute(sql`DELETE FROM booking_service_doctors WHERE service_id=${serviceId}`);for(const id of [...new Set(ids)])await tx.execute(sql`INSERT INTO booking_service_doctors(service_id,doctor_id) SELECT ${serviceId},id FROM users WHERE id=${id} AND activo AND (rol='medico' OR es_medico) ON CONFLICT DO NOTHING`);}
  private async availabilityForTx(tx:Tx,serviceId:string,doctorId:string|undefined,start:Date,end:Date,exclude?:string):Promise<{doctorId:string;doctorName:string}[]>{const r=await tx.execute(sql`SELECT u.id doctor_id,u.nombre doctor_name FROM users u JOIN booking_service_doctors x ON x.doctor_id=u.id JOIN booking_services s ON s.id=x.service_id JOIN booking_settings c ON true JOIN doctor_availability da ON da.doctor_id=u.id AND da.weekday=extract(dow FROM (${start.toISOString()}::timestamptz AT TIME ZONE c.timezone)) WHERE s.id=${serviceId} AND s.activo AND s.publico AND u.activo ${doctorId?sql`AND u.id=${doctorId}`:sql``} AND (${start.toISOString()}::timestamptz AT TIME ZONE c.timezone)::time>=da.inicio_local AND (${end.toISOString()}::timestamptz AT TIME ZONE c.timezone)::time<=da.fin_local AND mod(extract(epoch FROM (((${start.toISOString()}::timestamptz AT TIME ZONE c.timezone)::time)-da.inicio_local))::int,s.duracion_minutos*60)=0 AND ${start.toISOString()}::timestamptz>=now()+c.anticipacion_minima_horas*interval '1 hour' AND ${start.toISOString()}::timestamptz<now()+c.horizonte_dias*interval '1 day' AND NOT EXISTS(SELECT 1 FROM availability_exceptions e WHERE e.doctor_id=u.id AND e.fecha=(${start.toISOString()}::timestamptz AT TIME ZONE c.timezone)::date AND NOT e.disponible AND (e.inicio_local IS NULL OR tstzrange(${start.toISOString()}::timestamptz,${end.toISOString()}::timestamptz,'[)')&&tstzrange((e.fecha+e.inicio_local) AT TIME ZONE c.timezone,(e.fecha+e.fin_local) AT TIME ZONE c.timezone,'[)'))) AND NOT EXISTS(SELECT 1 FROM appointments a WHERE a.doctor_id=u.id AND a.estatus NOT IN('cancelada','no_asistio') ${exclude?sql`AND a.id<>${exclude}`:sql``} AND tstzrange(a.inicio_programado,a.fin_programado,'[)')&&tstzrange(${start.toISOString()}::timestamptz,${end.toISOString()}::timestamptz,'[)')) ORDER BY (SELECT count(*) FROM appointments a2 WHERE a2.doctor_id=u.id AND (a2.inicio_programado AT TIME ZONE c.timezone)::date=(${start.toISOString()}::timestamptz AT TIME ZONE c.timezone)::date),u.nombre,u.id LIMIT 1`);return (r.rows as any[]).map(x=>({doctorId:x.doctor_id,doctorName:x.doctor_name}));}
  private async getAppointmentRow(tx:Tx,hash:string):Promise<any>{const r=await tx.execute(sql`SELECT a.*,s.duracion_minutos,p.email,p.telefono_normalizado,p.whatsapp_opt_in_at,p.canal_preferido FROM appointments a JOIN booking_services s ON s.id=a.service_id JOIN patients p ON p.id=a.patient_id WHERE a.public_manage_token_hash=${hash} AND a.manage_token_expires_at>now() LIMIT 1`);if(!r.rows.length)throw new NotFoundException('Cita no encontrada');return r.rows[0];}
  private async summary(tx:Tx,hash:string):Promise<PublicAppointmentSummary>{const r=await tx.execute(sql`SELECT t.nombre_clinica,u.nombre doctor_nombre,a.inicio_programado,a.fin_programado,a.estatus,a.estado_confirmacion FROM appointments a JOIN users u ON u.id=a.doctor_id JOIN tenants t ON t.id=a.tenant_id WHERE a.public_manage_token_hash=${hash} AND a.manage_token_expires_at>now() LIMIT 1`);const x=r.rows[0] as any;if(!x)throw new NotFoundException('Cita no encontrada');return{clinicName:x.nombre_clinica,doctorName:x.doctor_nombre,start:new Date(x.inicio_programado).toISOString(),end:new Date(x.fin_programado).toISOString(),status:x.estatus,confirmationStatus:x.estado_confirmacion};}
  private async event(tx:Tx,id:string,event:'confirmed'|'cancelled'|'rescheduled'):Promise<void>{await tx.execute(sql`INSERT INTO messaging_events(appointment_id,event) VALUES(${id},${event})`);}
}

function hashToken(t:string):string{return createHash('sha256').update(t).digest('hex');}
function normalizeName(s:string):string{return s.trim().toLowerCase().replace(/\s+/g,' ');}
export function normalizePhone(s:string):string|null{const digits=s.replace(/\D/g,'');if(digits.length===10)return`+52${digits}`;if(digits.length===12&&digits.startsWith('52'))return`+${digits}`;if(digits.length>=11&&digits.length<=15)return`+${digits}`;return null;}
function isExclusion(e:unknown):boolean{return typeof e==='object'&&e!==null&&'code' in e&&(e as {code?:string}).code==='23P01';}
function startTooSoon(d:Date|string,hours:number):boolean{return new Date(d).getTime()-Date.now()<hours*3600000;}
function mapSettings(s:SettingsRow):BookingSettings{return{slug:s.slug,publicado:s.publicado,directorioPublico:s.directorio_publico,featureActiva:s.feature_activa,timezone:s.timezone,anticipacionMinimaHoras:s.anticipacion_minima_horas,horizonteDias:s.horizonte_dias,limiteCancelacionHoras:s.limite_cancelacion_horas,recordatoriosHoras:s.recordatorios_horas,avisoPrivacidadVersion:s.aviso_privacidad_version};}
function slugify(s:string):string{return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50)||'clinica';}
function validateTimezone(s:string):void{try{new Intl.DateTimeFormat('es-MX',{timeZone:s}).format();}catch{throw new BadRequestException('Zona horaria IANA inválida');}}
