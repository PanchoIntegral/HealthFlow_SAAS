import { Inject, Injectable } from '@nestjs/common';
import type { DiagnosticoCie10 } from '@healthflow/shared-types';
import { CIE10_REPOSITORY, type Cie10Repository } from '../domain/cie10.repository';

@Injectable()
export class BuscarCie10UseCase {
  constructor(@Inject(CIE10_REPOSITORY) private readonly repo: Cie10Repository) {}

  execute(query: string): Promise<DiagnosticoCie10[]> {
    const q = query.trim();
    if (q.length < 2) return Promise.resolve([]);
    return this.repo.buscar(q);
  }
}
