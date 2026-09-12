import { Inject, Injectable } from '@nestjs/common';
import { CapacidadService } from '../../../common/capacidad/capacidad.service';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import {
  RECALL_REPOSITORY,
  type FiltrosWorklist,
  type MetricasRecall,
  type PaginaWorklist,
  type RecallRepository,
} from '../domain/recall.repository';

const MODULO = 'dental_recalls' as const;

/**
 * La lista de trabajo de recepción.
 *
 * Lectura: se resuelve con `'lectura'` a propósito, así una clínica con el
 * pago atrasado puede seguir consultando a quién le debe seguimiento aunque no
 * pueda registrar gestiones nuevas.
 */
@Injectable()
export class ListRecallWorklistUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly capacidad: CapacidadService,
    @Inject(RECALL_REPOSITORY) private readonly repo: RecallRepository,
  ) {}

  async ejecutar(filtros: FiltrosWorklist): Promise<PaginaWorklist> {
    return this.tenantDb.run(async (tx) => {
      await this.capacidad.asegurar(tx, MODULO, 'lectura');
      return this.repo.listarWorklist(tx, { ...filtros, limit: Math.min(filtros.limit || 25, 100) });
    });
  }
}

/**
 * Métricas del módulo.
 *
 * Cada cifra declara su unidad en el tipo (`MetricasRecall`) porque mezclarlas
 * es el error clásico: contar mensajes como pacientes convierte a un paciente
 * insistido tres veces en tres pacientes contactados, y hace que el módulo
 * parezca funcionar el triple de bien de lo que funciona.
 *
 * "Ingreso recuperado" NO está: atribuir dinero a un control exige decidir si
 * cuenta lo presupuestado, lo terminado o lo cobrado, y con qué ventana. Es
 * una definición contable, no una consulta.
 */
@Injectable()
export class RecallMetricsUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly capacidad: CapacidadService,
    @Inject(RECALL_REPOSITORY) private readonly repo: RecallRepository,
  ) {}

  async ejecutar(desde: string, hasta: string): Promise<MetricasRecall> {
    return this.tenantDb.run(async (tx) => {
      await this.capacidad.asegurar(tx, MODULO, 'lectura');
      return this.repo.metricas(tx, desde, hasta);
    });
  }
}
