import { Inject, Injectable } from '@nestjs/common';
import type { WaitingRoomEntry } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import {
  APPOINTMENT_REPOSITORY,
  type AppointmentRepository,
} from '../domain/appointment.repository';

/** Carga inicial de la sala de espera (las suscripciones en vivo llegan por WebSocket). */
@Injectable()
export class ListWaitingRoomUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(APPOINTMENT_REPOSITORY) private readonly repo: AppointmentRepository,
  ) {}

  execute(): Promise<WaitingRoomEntry[]> {
    return this.tenantDb.run((tx) => this.repo.listWaitingRoom(tx));
  }
}
