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
 * ⚠️ NO EXPONER TODAVÍA. Esta clase existe para que el commit 8 tenga dónde
 * apoyarse, pero sus cifras aún NO son publicables — ni por API ni en pantalla.
 *
 * El motivo: "convertidos", "agotados" y la mediana se fechan con
 * `patient_recalls.updated_at`, que es MUTABLE. Cualquier escritura posterior
 * sobre el control —registrar una gestión, corregir el médico asignado, una
 * migración que toque la fila— lo mueve al periodo actual. Consecuencia: un
 * control convertido en marzo y editado en septiembre aparece como conversión
 * de septiembre, el informe de marzo cambia solo con el tiempo, y dos
 * consultas del mismo periodo pueden no coincidir.
 *
 * Para que sean publicables hace falta una FECHA INMUTABLE de conversión:
 * columnas `scheduled_at` y `exhausted_at` que se escriban UNA vez, en la
 * transición, y que ninguna edición posterior toque. Eso es una migración, y
 * va en el commit 8 junto con el resto de la observabilidad.
 *
 * Lo que sí es correcto hoy: "contactados", que se fecha con
 * `recall_attempts.created_at` —inmutable por construcción, un intento no se
 * re-crea— y "vencidos", con una salvedad que la pantalla debe respetar:
 *
 * **"vencidos" es el BACKLOG ACTUAL, no una cifra histórica.** Ignora el rango
 * de fechas a propósito: reconstruir "cuántos estaban vencidos en marzo"
 * exigiría un histórico de estados que no existe. Pedir enero–marzo devuelve
 * el pendiente de hoy. Es un número útil —es la lista que recepción tiene que
 * trabajar— pero ponerlo junto a las demás dentro de un informe por periodo
 * haría creer que pertenece al periodo, y esa lectura equivocada es
 * exactamente la clase de error que estas advertencias existen para evitar.
 *
 * Cada cifra declara su unidad en el tipo (`MetricasRecall`) porque mezclarlas
 * es el error clásico: contar mensajes como pacientes convierte a un paciente
 * insistido tres veces en tres pacientes contactados, y hace que el módulo
 * parezca funcionar el triple de bien de lo que funciona.
 *
 * "Ingreso recuperado" NO está, y es otra discusión: atribuir dinero a un
 * control exige decidir si cuenta lo presupuestado, lo terminado o lo cobrado,
 * y con qué ventana. Es una definición contable, no una consulta.
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
