import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  AppointmentStatus,
  AppointmentView,
  WaitingRoomEntry,
} from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import { AuditService } from '../../../common/audit/audit.service';
import { AppEventsService } from '../../../common/events/app-events.service';
import {
  APPOINTMENT_REPOSITORY,
  type AppointmentRepository,
} from '../domain/appointment.repository';
import {
  WAITING_ROOM_NOTIFIER,
  type WaitingRoomNotifier,
} from './waiting-room-notifier.port';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from '../../notifications/domain/notification.repository';
import {
  NOTIFICATIONS_NOTIFIER,
  type NotificationsNotifier,
} from '../../notifications/application/notifications-notifier.port';
import { MESSAGE_SCHEDULER, type MessageScheduler } from '../../messaging/messaging.types';
import { publicAppointmentTokenExpiry, publicAppointmentTokenHash } from '../../../common/public-links';

/**
 * Cancela una cita: agendada → cancelada (única transición previa al check-in;
 * ver ALLOWED_TRANSITIONS). Registra el motivo en la auditoría y notifica al
 * médico asignado (canal de notificaciones) y, si la cita es de HOY, también
 * a las salas de espera abiertas (canal de sala de espera): la tarjeta pasa
 * sola a la columna de terminadas, igual que ya listaría un refetch.
 */
@Injectable()
export class CancelAppointmentUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    private readonly audit: AuditService,
    private readonly eventos: AppEventsService,
    @Inject(APPOINTMENT_REPOSITORY) private readonly repo: AppointmentRepository,
    @Inject(WAITING_ROOM_NOTIFIER) private readonly notifier: WaitingRoomNotifier,
    @Inject(NOTIFICATION_REPOSITORY) private readonly notifications: NotificationRepository,
    @Inject(NOTIFICATIONS_NOTIFIER) private readonly notificationsNotifier: NotificationsNotifier,
    @Optional() @Inject(MESSAGE_SCHEDULER) private readonly messages?: MessageScheduler,
  ) {}

  async execute(appointmentId: string, motivo?: string | null): Promise<AppointmentView> {
    const { view, entry, previousStatus, notification } = await this.tenantDb.run(async (tx) => {
      const appointment = await this.repo.findById(tx, appointmentId);
      if (!appointment) throw new NotFoundException('Cita no encontrada');

      const previousStatus: AppointmentStatus = appointment.estatus;
      appointment.cancel(); // regla de dominio: valida agendada → cancelada
      await this.repo.save(tx, appointment);

      await this.audit.record(tx, {
        entidad: 'appointment',
        entidadId: appointmentId,
        accion: 'cancel',
        detalle: { motivo: motivo ?? null },
      });

      // Una cancelación es definitiva: reprogramar NO pasa por aquí, emite
      // `appointment.rescheduled` y no reabre ningún seguimiento.
      await this.eventos.emitir(tx, {
        tipo: 'appointment.cancelled',
        entidad: 'appointment',
        entidadId: appointmentId,
        payload: { patientId: appointment.patientId, doctorId: appointment.doctorId },
      });

      if (this.messages) {
        await this.messages.cancelPending(tx, appointmentId);
        const contact=(await tx.execute(sql`SELECT p.id,p.email,p.telefono_normalizado,p.whatsapp_opt_in_at,p.canal_preferido,a.inicio_programado FROM appointments a JOIN patients p ON p.id=a.patient_id WHERE a.id=${appointmentId}`)).rows[0] as any;
        if(contact) {
          const endsAt = appointment.toState().finProgramado;
          // Las citas antiguas creadas antes de los recordatorios no tenían
          // hash. Lo completamos antes de encolar la cancelación para que el
          // enlace enviado sea usable de inmediato.
          await tx.execute(sql`UPDATE appointments SET public_manage_token_hash=${publicAppointmentTokenHash(this.ctx.get().tenantId, appointmentId)},manage_token_expires_at=${publicAppointmentTokenExpiry(endsAt).toISOString()} WHERE id=${appointmentId} AND public_manage_token_hash IS NULL`);
          await this.messages.schedule(tx,{appointmentId,patientId:contact.id,startsAt:new Date(contact.inicio_programado),email:contact.email,phone:contact.telefono_normalizado,whatsappOptIn:!!contact.whatsapp_opt_in_at,preferredChannel:contact.canal_preferido??'ninguno',reminderHours:[],kind:'cancelled'});
        }
      }

      const view = await this.repo.findView(tx, appointmentId);
      if (!view) throw new NotFoundException('Cita no encontrada tras cancelarla');

      const notification = await this.notifications.create(tx, {
        userId: view.doctorId,
        appointmentId,
        tipo: 'cita_cancelada',
        titulo: 'Cita cancelada',
        mensaje: `${view.patientNombre} · ${new Date(view.inicioProgramado).toLocaleString('es-MX')}`,
      });

      // null si la cita no es de hoy: la sala de espera solo lista el día en curso.
      const entry: WaitingRoomEntry | null = await this.repo.findWaitingRoomEntry(
        tx,
        appointmentId,
        { soloHoy: true },
      );

      return { view, entry, previousStatus, notification };
    });

    // Efectos externos: solo tras confirmar la transacción.
    if (entry) {
      this.notifier.appointmentUpdated(this.ctx.get().tenantId, { entry, previousStatus });
    }
    this.notificationsNotifier.notificationCreated(this.ctx.get().tenantId, view.doctorId, {
      notification,
    });

    return view;
  }
}
