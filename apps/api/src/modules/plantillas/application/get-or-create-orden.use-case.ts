import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { OrdenPlantillasView } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import {
  APPOINTMENT_REPOSITORY,
  type AppointmentRepository,
} from '../../appointments/domain/appointment.repository';
import {
  ORDEN_PLANTILLAS_REPOSITORY,
  type OrdenPlantillasRepository,
} from '../domain/orden-plantillas.repository';

/**
 * Abre (o reabre) la orden de plantillas de una consulta. Se llama al abrir el
 * modal desde la pantalla de la nota: si es la primera vez, crea el borrador
 * vacío; si el médico ya la había abierto antes, devuelve la misma —igual que
 * `StartConsultationUseCase` reusa la nota existente en vez de duplicarla.
 */
@Injectable()
export class GetOrCreateOrdenPlantillasUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(APPOINTMENT_REPOSITORY) private readonly appointments: AppointmentRepository,
    @Inject(ORDEN_PLANTILLAS_REPOSITORY) private readonly ordenes: OrdenPlantillasRepository,
  ) {}

  execute(appointmentId: string): Promise<OrdenPlantillasView> {
    return this.tenantDb.run(async (tx) => {
      const existente = await this.ordenes.findByAppointment(tx, appointmentId);
      if (existente) return existente;

      const appointment = await this.appointments.findById(tx, appointmentId);
      if (!appointment) throw new NotFoundException('Cita no encontrada');

      return this.ordenes.create(tx, {
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        appointmentId,
      });
    });
  }
}
