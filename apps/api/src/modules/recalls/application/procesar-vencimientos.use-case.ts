import { Inject, Injectable, Logger } from '@nestjs/common';
import { CapacidadService } from '../../../common/capacidad/capacidad.service';
import type { Tx } from '../../../db/drizzle';
import { PatientRecall } from '../domain/recall.entity';
import { RECALL_REPOSITORY, type RecallRepository } from '../domain/recall.repository';
import { fechaLocal } from '../domain/fecha-local';

const MODULO = 'dental_recalls' as const;

/**
 * Barrido `pending → due`: lo que hace que un control aparezca en la lista de
 * recepción el día que toca.
 *
 * Es un BARRIDO por fecha y no un evento programado a futuro. Emitir un
 * `recall.due` con `available_at = due_date` parecía más elegante, pero
 * cambiar el intervalo de un tipo dejaría eventos huérfanos apuntando a fechas
 * viejas, y no hay forma de retirarlos. Un `UPDATE ... WHERE due_date <= hoy`
 * es idempotente por construcción: dos barridos concurrentes no se pelean, y
 * un cambio de periodicidad se respeta solo.
 *
 * La fecha es LOCAL de la clínica: a las 18:00 en Tijuana todavía no es
 * mañana, aunque en UTC sí.
 */
@Injectable()
export class ProcessDueRecallsUseCase {
  private readonly logger = new Logger(ProcessDueRecallsUseCase.name);

  constructor(
    private readonly capacidad: CapacidadService,
    @Inject(RECALL_REPOSITORY) private readonly repo: RecallRepository,
  ) {}

  /**
   * Recibe la transacción del tenant: lo invoca el worker, que itera clínicas.
   * Devuelve cuántos controles vencieron.
   */
  async ejecutar(tx: Tx, ahora = new Date(), limite = 200): Promise<number> {
    const capacidad = await this.capacidad.evaluar(tx, MODULO);
    // Una clínica sin el módulo disponible no vence controles. No es un error
    // —el worker recorre todas— así que se sale en silencio.
    if (capacidad.acceso !== 'completo') return 0;

    const zona = await this.repo.zonaHoraria(tx);
    const hoy = fechaLocal(ahora, zona);

    // SKIP LOCKED: dos workers pueden barrer a la vez y cada uno se lleva
    // controles distintos en vez de bloquearse.
    const ids = await this.repo.reclamarVencidos(tx, hoy, limite);
    let vencidos = 0;
    for (const id of ids) {
      const estado = await this.repo.cargarParaActualizar(tx, id);
      if (!estado) continue;
      const tipo = await this.repo.buscarTipo(tx, estado.recallTypeId);
      if (!tipo) continue;
      const recall = PatientRecall.desde(estado);
      recall.vencerCon(tipo, hoy);
      if (recall.status === 'due' && estado.status === 'pending') {
        await this.repo.guardar(tx, recall.snapshot);
        vencidos++;
      }
    }
    if (vencidos > 0) this.logger.log(`${vencidos} control(es) vencieron el ${hoy}`);
    return vencidos;
  }
}
