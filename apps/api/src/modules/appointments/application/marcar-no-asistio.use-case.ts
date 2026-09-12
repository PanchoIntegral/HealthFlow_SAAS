import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { AppointmentStatus, AppointmentView, WaitingRoomEntry } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import { AuditService } from '../../../common/audit/audit.service';
import { AppEventsService } from '../../../common/events/app-events.service';
import {
  APPOINTMENT_REPOSITORY,
  type AppointmentRepository,
} from '../domain/appointment.repository';
import { WAITING_ROOM_NOTIFIER, type WaitingRoomNotifier } from './waiting-room-notifier.port';
import { MESSAGE_SCHEDULER, type MessageScheduler } from '../../messaging/messaging.types';

/**
 * Registra que el paciente no asistió.
 *
 * Tres cosas pasan juntas o no pasan: la transición, la cancelación de los
 * mensajes que quedaran en cola para esa cita —recordarle a alguien una cita a
 * la que ya no vino es el peor momento posible— y el evento interno
 * `appointment.no_show`, que es lo que permite al módulo de Recall abrir un
 * seguimiento de reactivación.
 *
 * La tolerancia la decide la entidad (`markNoShow`), no este caso de uso: es
 * una regla de negocio y se prueba sin base de datos ni esperar media hora.
 *
 * El aviso a la sala de espera sale DESPUÉS del commit, como en el resto de
 * los casos de uso de citas: notificar una transición que después se revierte
 * dejaría las pantallas mostrando algo que no ocurrió.
 */
@Injectable()
export class MarcarNoAsistioUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    private readonly audit: AuditService,
    private readonly eventos: AppEventsService,
    @Inject(APPOINTMENT_REPOSITORY) private readonly repo: AppointmentRepository,
    @Inject(WAITING_ROOM_NOTIFIER) private readonly notifier: WaitingRoomNotifier,
    @Optional() @Inject(MESSAGE_SCHEDULER) private readonly messages?: MessageScheduler,
  ) {}

  async execute(appointmentId: string, ahora: Date = new Date()): Promise<AppointmentView> {
    const { view, entry, previousStatus } = await this.tenantDb.run(async (tx) => {
      const appointment = await this.repo.findById(tx, appointmentId);
      if (!appointment) throw new NotFoundException('Cita no encontrada');

      const previousStatus: AppointmentStatus = appointment.estatus;
      // Lanza AusenciaPrematuraError (409, con allowedAt) si aún no toca.
      appointment.markNoShow(ahora);
      await this.repo.save(tx, appointment);

      await this.audit.record(tx, {
        entidad: 'appointment',
        entidadId: appointmentId,
        accion: 'no_show',
        detalle: { previousStatus },
      });

      if (this.messages) await this.messages.cancelPending(tx, appointmentId);

      await this.eventos.emitir(tx, {
        tipo: 'appointment.no_show',
        entidad: 'appointment',
        entidadId: appointmentId,
        payload: { patientId: appointment.patientId, doctorId: appointment.doctorId },
      });

      const view = await this.repo.findView(tx, appointmentId);
      if (!view) throw new NotFoundException('Cita no encontrada tras marcarla');

      // null si la cita no es de hoy: la sala de espera sólo lista el día en curso.
      const entry: WaitingRoomEntry | null = await this.repo.findWaitingRoomEntry(
        tx,
        appointmentId,
        { soloHoy: true },
      );
      return { view, entry, previousStatus };
    });

    if (entry) {
      this.notifier.appointmentUpdated(this.ctx.get().tenantId, { entry, previousStatus });
    }
    return view;
  }
}
