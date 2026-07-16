import { Inject, Injectable } from '@nestjs/common';
import type { DoctorSummary } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import {
  APPOINTMENT_REPOSITORY,
  type AppointmentRepository,
} from '../domain/appointment.repository';

/** Médicos de la clínica activa, para el selector del formulario de nueva cita. */
@Injectable()
export class ListDoctorsUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(APPOINTMENT_REPOSITORY) private readonly repo: AppointmentRepository,
  ) {}

  execute(): Promise<DoctorSummary[]> {
    return this.tenantDb.run((tx) => this.repo.listDoctors(tx));
  }
}
