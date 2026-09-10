import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createAdminDb, createAppDb, runInTenant } from '../src/db/drizzle';
import { MessagingAdminController } from '../src/modules/messaging/messaging.controller';

describe('Métricas de reserva pública',()=>{
  const admin=createAdminDb(),appDb=createAppDb();
  const tenantId=randomUUID(),doctorId=randomUUID();
  const controller=new MessagingAdminController({
    run:<T>(fn:(tx:any)=>Promise<T>)=>runInTenant(appDb.db,tenantId,fn),
  } as any,{} as any);

  beforeAll(async()=>{
    await admin.db.execute(sql`INSERT INTO tenants(id,nombre_clinica,plan) VALUES(${tenantId}::uuid,'Métricas','consultorio')`);
    await admin.db.execute(sql`INSERT INTO users(id,tenant_id,email,password_hash,nombre,rol,es_medico) VALUES(${doctorId}::uuid,${tenantId}::uuid,${`${doctorId}@test.mx`},'x','Dra. Métrica','admin',true)`);
    const states=[
      ['agendada','confirmada',1,'publico','2026-09-02T16:00:00Z'],
      ['cancelada','cancelada',1,'publico','2026-09-03T16:00:00Z'],
      ['agendada','pendiente',2,'publico','2026-09-04T16:00:00Z'],
      ['no_asistio','pendiente',1,'publico','2026-09-05T16:00:00Z'],
      ['agendada','confirmada',1,'interno','2026-09-06T16:00:00Z'],
    ] as const;
    for(const [status,confirmation,version,origin,start] of states){
      const patientId=randomUUID(),appointmentId=randomUUID(),end=new Date(new Date(start).getTime()+1_800_000).toISOString();
      await admin.db.execute(sql`INSERT INTO patients(id,tenant_id,nombre,fecha_nacimiento) VALUES(${patientId}::uuid,${tenantId}::uuid,${`Paciente ${patientId}`},'1990-01-01')`);
      await admin.db.execute(sql`INSERT INTO appointments(id,tenant_id,patient_id,doctor_id,inicio_programado,fin_programado,estatus,estado_confirmacion,messaging_version,origen) VALUES(${appointmentId}::uuid,${tenantId}::uuid,${patientId}::uuid,${doctorId}::uuid,${start},${end},${status},${confirmation},${version},${origin})`);
      if(origin==='publico'&&confirmation==='confirmada') await admin.db.execute(sql`INSERT INTO outbound_messages(tenant_id,appointment_id,patient_id,channel,kind,scheduled_at,status,provider,idempotency_key,next_attempt_at) VALUES(${tenantId}::uuid,${appointmentId}::uuid,${patientId}::uuid,'email','confirmation',${start},'delivered','resend',${randomUUID()},${start})`);
    }
  });

  afterAll(async()=>{
    await admin.db.execute(sql`DELETE FROM tenants WHERE id=${tenantId}::uuid`);
    await Promise.all([admin.pool.end(),appDb.pool.end()]);
  });

  it('cuenta citas únicas aunque no tengan mensajes y excluye citas internas',async()=>{
    await expect(controller.metrics('2026-09-01T00:00:00Z','2026-10-01T00:00:00Z')).resolves.toEqual({
      publicBookings:4,delivered:1,confirmed:1,cancelled:1,rescheduled:1,noShows:1,
    });
  });
});
