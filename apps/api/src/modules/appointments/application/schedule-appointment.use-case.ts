import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AppointmentView, CreateAppointmentRequest } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { AuditService } from '../../../common/audit/audit.service';
import { Appointment } from '../domain/appointment.entity';
import { DoctorDoubleBookedError } from '../domain/appointment.errors';
import {
  APPOINTMENT_REPOSITORY,
  type AppointmentRepository,
} from '../domain/appointment.repository';

/**
 * Caso de uso: agendar una cita nueva. Valida el rango horario (dominio) y
 * que el médico no tenga otra cita activa traslapada (invariante de negocio
 * verificada contra la base de datos, dentro de la misma transacción).
 */
@Injectable()
export class ScheduleAppointmentUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    @Inject(APPOINTMENT_REPOSITORY) private readonly repo: AppointmentRepository,
  ) {}

  execute(input: CreateAppointmentRequest): Promise<AppointmentView> {
    const inicioProgramado = new Date(input.inicioProgramado);
    const finProgramado = new Date(input.finProgramado);

    Appointment.assertValidRange(inicioProgramado, finProgramado); // regla de dominio

    return this.tenantDb.run(async (tx) => {
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

      const view = await this.repo.findView(tx, id);
      if (!view) throw new NotFoundException('Cita no encontrada tras agendarla');
      return view;
    });
  }
}
