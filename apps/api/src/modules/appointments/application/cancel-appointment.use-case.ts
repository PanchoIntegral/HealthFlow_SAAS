import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AppointmentView } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import { AuditService } from '../../../common/audit/audit.service';
import {
  APPOINTMENT_REPOSITORY,
  type AppointmentRepository,
} from '../domain/appointment.repository';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from '../../notifications/domain/notification.repository';
import {
  NOTIFICATIONS_NOTIFIER,
  type NotificationsNotifier,
} from '../../notifications/application/notifications-notifier.port';

/**
 * Cancela una cita: agendada → cancelada (única transición previa al check-in;
 * ver ALLOWED_TRANSITIONS). Registra el motivo en la auditoría y notifica al
 * médico asignado.
 */
@Injectable()
export class CancelAppointmentUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    private readonly audit: AuditService,
    @Inject(APPOINTMENT_REPOSITORY) private readonly repo: AppointmentRepository,
    @Inject(NOTIFICATION_REPOSITORY) private readonly notifications: NotificationRepository,
    @Inject(NOTIFICATIONS_NOTIFIER) private readonly notificationsNotifier: NotificationsNotifier,
  ) {}

  async execute(appointmentId: string, motivo?: string | null): Promise<AppointmentView> {
    const { view, notification } = await this.tenantDb.run(async (tx) => {
      const appointment = await this.repo.findById(tx, appointmentId);
      if (!appointment) throw new NotFoundException('Cita no encontrada');

      appointment.cancel(); // regla de dominio: valida agendada → cancelada
      await this.repo.save(tx, appointment);

      await this.audit.record(tx, {
        entidad: 'appointment',
        entidadId: appointmentId,
        accion: 'cancel',
        detalle: { motivo: motivo ?? null },
      });

      const view = await this.repo.findView(tx, appointmentId);
      if (!view) throw new NotFoundException('Cita no encontrada tras cancelarla');

      const notification = await this.notifications.create(tx, {
        userId: view.doctorId,
        appointmentId,
        tipo: 'cita_cancelada',
        titulo: 'Cita cancelada',
        mensaje: `${view.patientNombre} · ${new Date(view.inicioProgramado).toLocaleString('es-MX')}`,
      });

      return { view, notification };
    });

    // Efecto externo: solo tras confirmar la transacción.
    this.notificationsNotifier.notificationCreated(this.ctx.get().tenantId, view.doctorId, {
      notification,
    });

    return view;
  }
}
