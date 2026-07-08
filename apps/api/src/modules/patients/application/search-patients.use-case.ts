import { Inject, Injectable } from '@nestjs/common';
import type { PatientSummary } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import {
  PATIENT_REPOSITORY,
  type PatientRepository,
} from '../domain/patient.repository';

const MAX_RESULTS = 20;

/** Caso de uso: buscador de pacientes por nombre o CURP. */
@Injectable()
export class SearchPatientsUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(PATIENT_REPOSITORY) private readonly repo: PatientRepository,
  ) {}

  execute(query: string): Promise<PatientSummary[]> {
    const q = query.trim();
    if (q.length < 2) return Promise.resolve([]); // evita barridos con 1 caracter
    return this.tenantDb.run((tx) => this.repo.search(tx, q, MAX_RESULTS));
  }
}
