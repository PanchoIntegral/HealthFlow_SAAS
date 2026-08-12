import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  HorarioAtencion,
  HuecoDisponible,
  ReagendaCitaView,
} from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import { AuditService } from '../../../common/audit/audit.service';
import { SystemContextRunner } from '../../../common/tenant-context/system-context.runner';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import {
  APPOINTMENT_REPOSITORY,
  type AppointmentRepository,
} from '../../appointments/domain/appointment.repository';
import {
  WHATSAPP_CONFIG_REPOSITORY,
  type WhatsappConfigRepository,
} from '../domain/whatsapp-config.repository';
import { generarHuecos, DIAS_MAXIMOS, MAX_HUECOS, type Ocupado } from '../domain/huecos';
import { CitaNoReagendableError, TokenReagendaInvalidoError } from '../domain/whatsapp.errors';
import { ReagendaTokensService } from './reagenda-tokens.service';

/** Datos mínimos de la cita para la página pública. */
interface FilaCita {
  estatus: string;
  inicio_programado: Date;
  fin_programado: Date;
  doctor_id: string;
  doctor_nombre: string;
  nombre_clinica: string;
}

/**
 * Reagendado desde el enlace que recibe el paciente por WhatsApp.
 *
 * Todo lo que sale de aquí va a un navegador SIN sesión, así que la regla es
 * estricta: **nada clínico**. Ni el motivo de la consulta, ni la CURP, ni el
 * historial, ni siquiera el nombre completo del paciente. Lo justo para que
 * quien abre el enlace reconozca su cita: clínica, médico y hora.
 */
@Injectable()
export class ReagendarCitaUseCase {
  private readonly logger = new Logger(ReagendarCitaUseCase.name);

  constructor(
    private readonly tokens: ReagendaTokensService,
    private readonly systemCtx: SystemContextRunner,
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    @Inject(APPOINTMENT_REPOSITORY) private readonly citas: AppointmentRepository,
    @Inject(WHATSAPP_CONFIG_REPOSITORY) private readonly configRepo: WhatsappConfigRepository,
  ) {}

  /** Lo que pinta la página al abrir el enlace. */
  async ver(token: string): Promise<ReagendaCitaView> {
    const ruta = await this.tokens.resolver(token);
    if (!ruta) throw new TokenReagendaInvalidoError();

    return this.tokens.enTenant(ruta.tenantId, async (tx) => {
      const cita = await leerCita(tx, ruta.appointmentId);
      if (!cita) throw new TokenReagendaInvalidoError();
      if (cita.estatus !== 'agendada') throw new CitaNoReagendableError(cita.estatus);

      return {
        nombreClinica: cita.nombre_clinica,
        doctorNombre: cita.doctor_nombre,
        inicioProgramado: new Date(cita.inicio_programado).toISOString(),
        duracionMinutos: duracion(cita),
      };
    });
  }

  /** Horarios libres del MISMO médico, de la misma duración. */
  async huecos(token: string, desde: Date, ahora: Date = new Date()): Promise<HuecoDisponible[]> {
    const ruta = await this.tokens.resolver(token);
    if (!ruta) throw new TokenReagendaInvalidoError();

    return this.tokens.enTenant(ruta.tenantId, async (tx) => {
      const cita = await leerCita(tx, ruta.appointmentId);
      if (!cita) throw new TokenReagendaInvalidoError();
      if (cita.estatus !== 'agendada') throw new CitaNoReagendableError(cita.estatus);

      const config = await this.configRepo.find(tx, ruta.tenantId);
      const ocupados = await agendaDelMedico(tx, cita.doctor_id, desde, DIAS_MAXIMOS);

      return generarHuecos({
        desde,
        dias: DIAS_MAXIMOS,
        duracionMinutos: duracion(cita),
        horario: (config?.horarioAtencion ?? HORARIO_POR_DEFECTO) as HorarioAtencion,
        tz: config?.zonaHoraria ?? 'America/Mexico_City',
        ocupados,
        ahora,
        max: MAX_HUECOS,
      }).map((h) => ({ inicio: h.inicio.toISOString(), fin: h.fin.toISOString() }));
    });
  }

  /** Mueve la cita al horario elegido y quema el token. */
  async reagendar(token: string, inicio: Date, ahora: Date = new Date()): Promise<ReagendaCitaView> {
    // Consumir ANTES de trabajar: si dos pestañas envían a la vez, solo una
    // pasa de aquí. El consumo y la validación ocurren en la misma llamada.
    const ruta = await this.tokens.consumir(token);
    if (!ruta) throw new TokenReagendaInvalidoError();

    return this.systemCtx.run(ruta.tenantId, async () =>
      this.tenantDb.run(async (tx) => {
        const cita = await leerCita(tx, ruta.appointmentId);
        if (!cita) throw new TokenReagendaInvalidoError();
        if (cita.estatus !== 'agendada') throw new CitaNoReagendableError(cita.estatus);

        const minutos = duracion(cita);
        const fin = new Date(inicio.getTime() + minutos * 60_000);

        // El horario que manda el navegador se revalida contra la agenda: la
        // lista de huecos pudo quedar obsoleta mientras el paciente decidía, y
        // nada impide mandar un instante que nunca se ofreció.
        if (inicio.getTime() <= ahora.getTime()) throw new CitaNoReagendableError(cita.estatus);
        const ocupado = await this.citas.hasOverlap(
          tx,
          cita.doctor_id,
          inicio,
          fin,
          ruta.appointmentId,
        );
        if (ocupado) throw new CitaNoReagendableError('horario ocupado');

        await tx.execute(sql`
          UPDATE appointments
             SET inicio_programado = ${inicio.toISOString()},
                 fin_programado = ${fin.toISOString()},
                 -- El paciente acaba de elegir hora: eso ES una confirmación.
                 confirmada_at = ${ahora.toISOString()}
           WHERE id = ${ruta.appointmentId}
        `);

        // El recordatorio ya encolado apuntaba a la hora vieja: se descarta
        // para que el barrido genere uno nuevo con la hora correcta.
        await tx.execute(sql`
          DELETE FROM whatsapp_outbox
           WHERE appointment_id = ${ruta.appointmentId}
             AND plantilla = 'recordatorio_cita'
             AND estado = 'pendiente'
        `);

        await this.audit.record(tx, {
          entidad: 'appointment',
          entidadId: ruta.appointmentId,
          accion: 'reagendar',
          detalle: {
            origen: 'whatsapp',
            de: new Date(cita.inicio_programado).toISOString(),
            a: inicio.toISOString(),
          },
        });

        this.logger.log(`Cita ${ruta.appointmentId} reagendada por el paciente`);
        return {
          nombreClinica: cita.nombre_clinica,
          doctorNombre: cita.doctor_nombre,
          inicioProgramado: inicio.toISOString(),
          duracionMinutos: minutos,
        };
      }),
    );
  }
}

const HORARIO_POR_DEFECTO: HorarioAtencion = {
  dias: [1, 2, 3, 4, 5],
  desde: '09:00',
  hasta: '18:00',
};

/**
 * Solo los campos que la página necesita. En particular NO se lee `motivo`:
 * el resultado viaja a un navegador sin sesión.
 */
async function leerCita(tx: Tx, appointmentId: string): Promise<FilaCita | null> {
  const r = await tx.execute(sql`
    SELECT a.estatus, a.inicio_programado, a.fin_programado, a.doctor_id,
           u.nombre AS doctor_nombre, t.nombre_clinica
      FROM appointments a
      JOIN users u   ON u.id = a.doctor_id
      JOIN tenants t ON t.id = a.tenant_id
     WHERE a.id = ${appointmentId}
  `);
  return (r.rows[0] as FilaCita | undefined) ?? null;
}

/** Citas del médico que bloquean horario, para descontarlas de los huecos. */
async function agendaDelMedico(
  tx: Tx,
  doctorId: string,
  desde: Date,
  dias: number,
): Promise<Ocupado[]> {
  const hasta = new Date(desde.getTime() + dias * 24 * 60 * 60 * 1000);
  const r = await tx.execute(sql`
    SELECT inicio_programado, fin_programado
      FROM appointments
     WHERE doctor_id = ${doctorId}
       AND estatus NOT IN ('cancelada', 'no_asistio')
       AND inicio_programado < ${hasta.toISOString()}
       AND fin_programado > ${desde.toISOString()}
  `);
  return (r.rows as unknown as { inicio_programado: Date; fin_programado: Date }[]).map((f) => ({
    inicio: new Date(f.inicio_programado),
    fin: new Date(f.fin_programado),
  }));
}

function duracion(cita: FilaCita): number {
  const ms = new Date(cita.fin_programado).getTime() - new Date(cita.inicio_programado).getTime();
  return Math.max(Math.round(ms / 60_000), 15);
}
