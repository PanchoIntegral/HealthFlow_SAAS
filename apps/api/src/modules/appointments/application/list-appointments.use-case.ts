import { Inject, Injectable } from '@nestjs/common';
import type { AppointmentView } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import {
  APPOINTMENT_REPOSITORY,
  type AppointmentRepository,
} from '../domain/appointment.repository';

/** Citas del rango de fechas visible en el calendario. */
@Injectable()
export class ListAppointmentsUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(APPOINTMENT_REPOSITORY) private readonly repo: AppointmentRepository,
  ) {}

  execute(from: Date, to: Date): Promise<AppointmentView[]> {
    return this.tenantDb.run((tx) => this.repo.listByRange(tx, from, to));
  }
}
