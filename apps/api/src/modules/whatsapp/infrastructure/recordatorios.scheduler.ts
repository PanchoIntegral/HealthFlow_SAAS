import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { env } from '../../../config/env';
import { MaterializarRecordatoriosUseCase } from '../application/materializar-recordatorios.use-case';
import { DespacharOutboxUseCase } from '../application/despachar-outbox.use-case';
import { PurgarEventosUseCase } from '../application/purgar-eventos.use-case';

const NOMBRE_TAREA = 'whatsapp-recordatorios';

/**
 * El reloj de los recordatorios.
 *
 * Hasta aquí el único disparador del sistema era una petición HTTP: el scan de
 * notificaciones in-app corre dentro de cada `GET /notifications`, "mientras
 * alguien tenga la app abierta". Para un badge sirve; para esto no: el aviso de
 * 24 horas antes tiene que salir a las 8 de la mañana con la clínica cerrada y
 * nadie frente al navegador.
 *
 * El intervalo se registra a mano en `onModuleInit` y no con `@Interval`
 * porque el decorador se evalúa al importar la clase, antes de poder decidir si
 * esta instalación debe correrlo. Los tests de integración levantan el
 * `AppModule` completo, y un barrido de fondo escribiendo en la base mientras
 * corren otros specs produce fallos intermitentes imposibles de reproducir.
 */
@Injectable()
export class RecordatoriosScheduler implements OnModuleInit {
  private readonly logger = new Logger(RecordatoriosScheduler.name);

  /**
   * Un tick lento no debe solaparse con el siguiente: `setInterval` no espera
   * al anterior. El lock de Postgres cubre el caso de varias instancias; esta
   * bandera cubre el de una sola con un barrido largo.
   */
  private corriendo = false;

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly materializar: MaterializarRecordatoriosUseCase,
    private readonly despachar: DespacharOutboxUseCase,
    private readonly purgar: PurgarEventosUseCase,
  ) {}

  onModuleInit(): void {
    if (!env.whatsappSchedulerEnabled) {
      this.logger.log('Barrido de recordatorios desactivado en este proceso');
      return;
    }
    const cada = env.whatsappSchedulerIntervalMs;
    const intervalo = setInterval(() => void this.barrer(), cada);
    this.registry.addInterval(NOMBRE_TAREA, intervalo);
    this.logger.log(`Barrido de recordatorios cada ${Math.round(cada / 1000)}s`);
  }

  /**
   * Un ciclo completo. Público para que los tests lo disparen a mano en vez de
   * esperar al reloj.
   */
  async barrer(
    ahora: Date = new Date(),
  ): Promise<{ encolados: number; enviados: number; eventos: number }> {
    if (this.corriendo) {
      this.logger.warn('El barrido anterior sigue corriendo: se salta este tick');
      return { encolados: 0, enviados: 0, eventos: 0 };
    }
    this.corriendo = true;
    try {
      // Los dos pasos son independientes a propósito: si materializar falla
      // para todas las clínicas, lo que ya estaba encolado igual sale.
      let encolados = 0;
      try {
        encolados = await this.materializar.execute(ahora);
      } catch (error) {
        this.logger.error(`Falló la materialización: ${mensaje(error)}`);
      }

      let enviados = 0;
      try {
        enviados = await this.despachar.execute(ahora);
      } catch (error) {
        this.logger.error(`Falló el despacho: ${mensaje(error)}`);
      }

      // Limpieza de la bitácora de eventos de Meta. No es reprocesamiento: los
      // eventos se procesan en el propio webhook y, si fallan, se borra su
      // marca para que el reintento de Meta los vuelva a traer con su payload.
      // Aquí solo se tira lo viejo, que ya no sirve ni para deduplicar.
      let eventos = 0;
      try {
        eventos = await this.purgar.execute(ahora);
      } catch (error) {
        this.logger.error(`Falló la purga de eventos: ${mensaje(error)}`);
      }

      if (encolados || enviados) {
        this.logger.log(`Barrido: ${encolados} encolado(s), ${enviados} enviado(s)`);
      }
      return { encolados, enviados, eventos };
    } finally {
      this.corriendo = false;
    }
  }
}

function mensaje(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
