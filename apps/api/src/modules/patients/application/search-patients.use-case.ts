import { Inject, Injectable } from '@nestjs/common';
import type { PatientSummary } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import {
  PATIENT_REPOSITORY,
  type PatientRepository,
} from '../domain/patient.repository';

const MAX_RESULTS = 20;
const MAX_DIRECTORY = 200;

/**
 * Caso de uso: buscador/directorio de pacientes. Sin query (o con 1 caracter)
 * devuelve el directorio completo del tenant ordenado por nombre — es la vista
 * inicial de "Expedientes"; con 2+ caracteres busca por nombre o CURP.
 */
@Injectable()
export class SearchPatientsUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(PATIENT_REPOSITORY) private readonly repo: PatientRepository,
  ) {}

  execute(query: string): Promise<PatientSummary[]> {
    const q = query.trim();
    if (q.length < 2) return this.tenantDb.run((tx) => this.repo.list(tx, MAX_DIRECTORY));
    return this.tenantDb.run((tx) => this.repo.search(tx, q, MAX_RESULTS));
  }
}
