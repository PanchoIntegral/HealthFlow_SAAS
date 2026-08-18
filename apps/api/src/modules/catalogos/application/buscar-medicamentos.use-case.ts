import { Inject, Injectable } from '@nestjs/common';
import type { MedicamentoCatalogo } from '@healthflow/shared-types';
import {
  MEDICAMENTO_REPOSITORY,
  type MedicamentoRepository,
} from '../domain/medicamento.repository';

/**
 * Búsqueda en el catálogo de medicamentos.
 *
 * A diferencia de `BuscarCie10UseCase` no lee la especialidad del médico ni
 * usa `TenantDbService`: no hay una priorización por especialidad que aplicar
 * —un antibiótico lo receta cualquiera— y la tabla es global, sin RLS.
 *
 * Los resultados incluyen los medicamentos de fracción I y II aunque el
 * sistema no pueda emitirlos: la UI los muestra deshabilitados con el motivo.
 * Esconderlos haría que el médico los capturara por texto libre, que es
 * justamente el camino donde el bloqueo no puede dispararse.
 */
@Injectable()
export class BuscarMedicamentosUseCase {
  constructor(
    @Inject(MEDICAMENTO_REPOSITORY) private readonly repo: MedicamentoRepository,
  ) {}

  async execute(query: string): Promise<MedicamentoCatalogo[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    return this.repo.buscar(q);
  }
}
