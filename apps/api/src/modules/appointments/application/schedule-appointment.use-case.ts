import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  AppointmentView,
  CreateAppointmentRequest,
  WaitingRoomEntry,
} from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import { AuditService } from '../../../common/audit/audit.service';
import { Appointment } from '../domain/appointment.entity';
import { DoctorDoubleBookedError } from '../domain/appointment.errors';
import {
  APPOINTMENT_REPOSITORY,
  type AppointmentRepository,
} from '../domain/appointment.repository';
import {
  WAITING_ROOM_NOTIFIER,
  type WaitingRoomNotifier,
} from './waiting-room-notifier.port';
import { MESSAGE_SCHEDULER, type MessageScheduler } from '../../messaging/messaging.types';

/**
 * Caso de uso: agendar una cita nueva. Valida el rango horario (dominio) y
 * que el médico no tenga otra cita activa traslapada (invariante de negocio
 * verificada contra la base de datos, dentro de la misma transacción).
 *
 * Si la cita es de HOY, notifica por WebSocket para que las salas de espera
 * ya abiertas la den de alta sin refrescar (`previousStatus: null` = alta).
 */
@Injectable()
export class ScheduleAppointmentUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    private readonly audit: AuditService,
    @Inject(APPOINTMENT_REPOSITORY) private readonly repo: AppointmentRepository,
    @Inject(WAITING_ROOM_NOTIFIER) private readonly notifier: WaitingRoomNotifier,
    @Optional() @Inject(MESSAGE_SCHEDULER) private readonly messages?: MessageScheduler,
  ) {}

  async execute(input: CreateAppointmentRequest): Promise<AppointmentView> {
    const inicioProgramado = new Date(input.inicioProgramado);
    const finProgramado = new Date(input.finProgramado);

    Appointment.assertValidRange(inicioProgramado, finProgramado); // regla de dominio

    const { view, entry } = await this.tenantDb.run(async (tx) => {
      const overlap = await this.repo.hasOverlap(tx, input.doctorId, inicioProgramado, finProgramado);
      if (overlap) throw new DoctorDoubleBookedError();

      const id = await this.repo.create(tx, {
        patientId: input.patientId,
        doctorId: input.doctorId,
        motivo: input.motivo ?? null,
        inicioProgramado,
        finProgramado,
      });

      await this.audit.record(tx, {
        entidad: 'appointment',
        entidadId: id,
        accion: 'schedule',
        detalle: { patientId: input.patientId, doctorId: input.doctorId },
      });

      if (this.messages) {
        const contact = (await tx.execute(sql`
          SELECT p.email,p.telefono_normalizado,p.whatsapp_opt_in_at,p.canal_preferido,
                 coalesce(bs.recordatorios_horas,ARRAY[48,24]) recordatorios_horas
            FROM patients p LEFT JOIN booking_settings bs ON true WHERE p.id=${input.patientId}
        `)).rows[0] as any;
        if (contact) await this.messages.schedule(tx, {
          appointmentId:id,patientId:input.patientId,startsAt:inicioProgramado,
          email:contact.email,phone:contact.telefono_normalizado,
          whatsappOptIn:!!contact.whatsapp_opt_in_at,preferredChannel:contact.canal_preferido??'ninguno',
          reminderHours:contact.recordatorios_horas??[48,24],
        });
      }

      const view = await this.repo.findView(tx, id);
      if (!view) throw new NotFoundException('Cita no encontrada tras agendarla');

      // null si la cita no es de hoy: la sala de espera solo lista el día en curso.
      const entry: WaitingRoomEntry | null = await this.repo.findWaitingRoomEntry(tx, id, {
        soloHoy: true,
      });

      return { view, entry };
    });

    // Efecto externo: solo tras confirmar la transacción.
    if (entry) {
      this.notifier.appointmentUpdated(this.ctx.get().tenantId, {
        entry,
        previousStatus: null, // cita recién creada: no hay estado anterior
      });
    }

    return view;
  }
}
