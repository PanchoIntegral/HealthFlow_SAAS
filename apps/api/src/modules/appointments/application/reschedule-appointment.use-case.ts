import { ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { AppointmentView, RescheduleAppointmentRequest, WaitingRoomEntry } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import { AuditService } from '../../../common/audit/audit.service';
import { AppEventsService } from '../../../common/events/app-events.service';
import { Appointment } from '../domain/appointment.entity';
import { DoctorDoubleBookedError } from '../domain/appointment.errors';
import { APPOINTMENT_REPOSITORY, type AppointmentRepository } from '../domain/appointment.repository';
import { WAITING_ROOM_NOTIFIER, type WaitingRoomNotifier } from './waiting-room-notifier.port';
import { MESSAGE_SCHEDULER, type MessageScheduler } from '../../messaging/messaging.types';

/** Reprograma una cita interna sin cancelarla ni perder su identificador. */
@Injectable()
export class RescheduleAppointmentUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    private readonly audit: AuditService,
    private readonly eventos: AppEventsService,
    @Inject(APPOINTMENT_REPOSITORY) private readonly repo: AppointmentRepository,
    @Inject(WAITING_ROOM_NOTIFIER) private readonly notifier: WaitingRoomNotifier,
    @Optional() @Inject(MESSAGE_SCHEDULER) private readonly messages?: MessageScheduler,
  ) {}

  async execute(appointmentId: string, input: RescheduleAppointmentRequest): Promise<AppointmentView> {
    const inicioProgramado = new Date(input.inicioProgramado);
    const finProgramado = new Date(input.finProgramado);
    Appointment.assertValidRange(inicioProgramado, finProgramado);

    const { view, entry } = await this.tenantDb.run(async (tx) => {
      const appointment = await this.repo.findById(tx, appointmentId);
      if (!appointment) throw new NotFoundException('Cita no encontrada');
      if (appointment.estatus !== 'agendada') throw new ConflictException('Sólo se pueden reprogramar citas agendadas');
      if (await this.repo.hasOverlap(tx, input.doctorId, inicioProgramado, finProgramado, appointmentId)) {
        throw new DoctorDoubleBookedError();
      }

      const previous = await this.repo.findView(tx, appointmentId);
      if (!previous) throw new NotFoundException('Cita no encontrada');
      await this.repo.reschedule(tx, appointmentId, { doctorId: input.doctorId, inicioProgramado, finProgramado });
      await this.audit.record(tx, {
        entidad: 'appointment', entidadId: appointmentId, accion: 'reschedule',
        detalle: { doctorId: input.doctorId, inicioAnterior: previous.inicioProgramado, inicioNuevo: inicioProgramado.toISOString() },
      });
      await this.eventos.emitir(tx, {
        tipo: 'appointment.rescheduled', entidad: 'appointment', entidadId: appointmentId,
        payload: { patientId: appointment.patientId, doctorId: input.doctorId, inicioAnterior: previous.inicioProgramado, inicioNuevo: inicioProgramado.toISOString() },
      });

      if (this.messages) {
        await this.messages.cancelPending(tx, appointmentId);
        const contact = (await tx.execute(sql`
          SELECT p.id,p.email,p.telefono_normalizado,p.whatsapp_opt_in_at,p.canal_preferido,
                 coalesce(bs.recordatorios_horas,ARRAY[48,24]) recordatorios_horas
            FROM patients p LEFT JOIN booking_settings bs ON true WHERE p.id=${appointment.patientId}
        `)).rows[0] as any;
        if (contact) await this.messages.schedule(tx, {
          appointmentId, patientId: appointment.patientId, startsAt: inicioProgramado,
          email: contact.email, phone: contact.telefono_normalizado,
          whatsappOptIn: !!contact.whatsapp_opt_in_at, preferredChannel: contact.canal_preferido ?? 'ninguno',
          reminderHours: contact.recordatorios_horas ?? [48, 24], kind: 'rescheduled',
        });
      }

      const view = await this.repo.findView(tx, appointmentId);
      if (!view) throw new NotFoundException('Cita no encontrada tras reprogramarla');
      const entry: WaitingRoomEntry | null = await this.repo.findWaitingRoomEntry(tx, appointmentId, { soloHoy: true });
      return { view, entry };
    });

    if (entry) this.notifier.appointmentUpdated(this.ctx.get().tenantId, { entry, previousStatus: 'agendada' });
    return view;
  }
}
