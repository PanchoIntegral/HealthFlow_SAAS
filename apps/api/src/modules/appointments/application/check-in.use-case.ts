import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { WaitingRoomEntry } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import { AuditService } from '../../../common/audit/audit.service';
import {
  APPOINTMENT_REPOSITORY,
  type AppointmentRepository,
} from '../domain/appointment.repository';
import {
  WAITING_ROOM_NOTIFIER,
  type WaitingRoomNotifier,
} from './waiting-room-notifier.port';

/**
 * Caso de uso: check-in del paciente (agendada → en_espera).
 *
 * Orquesta el dominio y sus efectos secundarios en UNA transacción:
 *   1. carga la cita, 2. aplica la regla de dominio (transición de estado),
 *   3. persiste, 4. audita. Recién confirmada la transacción, 5. notifica por
 *   WebSocket (efecto externo, fuera de la transacción de DB).
 */
@Injectable()
export class CheckInUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    private readonly audit: AuditService,
    @Inject(APPOINTMENT_REPOSITORY) private readonly repo: AppointmentRepository,
    @Inject(WAITING_ROOM_NOTIFIER) private readonly notifier: WaitingRoomNotifier,
  ) {}

  async execute(appointmentId: string): Promise<WaitingRoomEntry> {
    const entry = await this.tenantDb.run(async (tx) => {
      const appointment = await this.repo.findById(tx, appointmentId);
      if (!appointment) {
        throw new NotFoundException('Cita no encontrada');
      }

      appointment.checkIn(); // regla de dominio: valida agendada → en_espera
      await this.repo.save(tx, appointment);

      await this.audit.record(tx, {
        entidad: 'appointment',
        entidadId: appointmentId,
        accion: 'check_in',
        detalle: { checkinAt: appointment.checkinAt?.toISOString() },
      });

      const view = await this.repo.findWaitingRoomEntry(tx, appointmentId);
      if (!view) throw new NotFoundException('Cita no encontrada tras check-in');
      return view;
    });

    // Efecto externo: solo tras confirmar la transacción.
    this.notifier.appointmentUpdated(this.ctx.get().tenantId, {
      entry,
      previousStatus: 'agendada',
    });

    return entry;
  }
}
