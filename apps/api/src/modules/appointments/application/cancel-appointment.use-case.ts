import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AppointmentView } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { AuditService } from '../../../common/audit/audit.service';
import {
  APPOINTMENT_REPOSITORY,
  type AppointmentRepository,
} from '../domain/appointment.repository';

/**
 * Cancela una cita: agendada → cancelada (única transición previa al check-in;
 * ver ALLOWED_TRANSITIONS). Registra el motivo en la auditoría.
 */
@Injectable()
export class CancelAppointmentUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    @Inject(APPOINTMENT_REPOSITORY) private readonly repo: AppointmentRepository,
  ) {}

  execute(appointmentId: string, motivo?: string | null): Promise<AppointmentView> {
    return this.tenantDb.run(async (tx) => {
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
      return view;
    });
  }
}
