import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { CapacidadService } from '../../../common/capacidad/capacidad.service';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import {
  RECALL_REPOSITORY,
  type CambiosTipoRecall,
  type ConfiguracionRecall,
  type NuevoTipoRecall,
  type RecallRepository,
  type TipoRecall,
} from '../domain/recall.repository';
import {
  TipoRecallDuplicadoError,
  TipoRecallInactivoError,
  TipoRecallNoEncontradoError,
} from '../domain/recall.errors';
import { esViolacionDeUnicidad } from './actor';

const MODULO = 'dental_recalls' as const;

/** Alta de un tipo de control (limpieza, revisión, control periodontal…). */
@Injectable()
export class CreateRecallTypeUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly capacidad: CapacidadService,
    private readonly audit: AuditService,
    @Inject(RECALL_REPOSITORY) private readonly repo: RecallRepository,
  ) {}

  async ejecutar(input: NuevoTipoRecall): Promise<TipoRecall> {
    return this.tenantDb.run(async (tx) => {
      await this.capacidad.asegurar(tx, MODULO, 'escritura');
      try {
        const tipo = await this.repo.crearTipo(tx, { ...input, nombre: input.nombre.trim() });
        await this.audit.record(tx, {
          entidad: 'RecallType',
          entidadId: tipo.id,
          accion: 'crear',
          detalle: { nombre: tipo.nombre, intervalMonths: tipo.intervalMonths },
        });
        return tipo;
      } catch (error) {
        // El índice único parcial es quien decide, no una consulta previa:
        // entre el SELECT y el INSERT cabe otra petición.
        if (esViolacionDeUnicidad(error)) throw new TipoRecallDuplicadoError(input.nombre.trim());
        throw error;
      }
    });
  }
}

/** Edición del catálogo. Desactivar conserva el histórico de controles. */
@Injectable()
export class UpdateRecallTypeUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly capacidad: CapacidadService,
    private readonly audit: AuditService,
    @Inject(RECALL_REPOSITORY) private readonly repo: RecallRepository,
  ) {}

  async ejecutar(id: string, cambios: CambiosTipoRecall): Promise<TipoRecall> {
    return this.tenantDb.run(async (tx) => {
      await this.capacidad.asegurar(tx, MODULO, 'escritura');
      try {
        const tipo = await this.repo.actualizarTipo(tx, id, {
          ...cambios,
          nombre: cambios.nombre?.trim(),
        });
        if (!tipo) throw new TipoRecallNoEncontradoError();
        await this.audit.record(tx, {
          entidad: 'RecallType',
          entidadId: tipo.id,
          accion: cambios.activo === false ? 'desactivar' : 'editar',
          // Sólo las CLAVES que cambiaron: el detalle documenta qué se tocó,
          // no duplica el estado completo del tipo.
          detalle: { campos: Object.keys(cambios) },
        });
        return tipo;
      } catch (error) {
        if (esViolacionDeUnicidad(error)) {
          throw new TipoRecallDuplicadoError(cambios.nombre?.trim() ?? '');
        }
        throw error;
      }
    });
  }
}

/** Listado del catálogo. Lectura: pasa aunque la suscripción esté vencida. */
@Injectable()
export class ListRecallTypesUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly capacidad: CapacidadService,
    @Inject(RECALL_REPOSITORY) private readonly repo: RecallRepository,
  ) {}

  async ejecutar(soloActivos = false): Promise<TipoRecall[]> {
    return this.tenantDb.run(async (tx) => {
      await this.capacidad.asegurar(tx, MODULO, 'lectura');
      return this.repo.listarTipos(tx, soloActivos);
    });
  }
}

/** Configuración de la reactivación por inasistencia. */
@Injectable()
export class RecallSettingsUseCases {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly capacidad: CapacidadService,
    private readonly audit: AuditService,
    @Inject(RECALL_REPOSITORY) private readonly repo: RecallRepository,
  ) {}

  async leer(): Promise<ConfiguracionRecall> {
    return this.tenantDb.run(async (tx) => {
      await this.capacidad.asegurar(tx, MODULO, 'lectura');
      return this.repo.leerConfiguracion(tx);
    });
  }

  async guardar(input: ConfiguracionRecall): Promise<ConfiguracionRecall> {
    return this.tenantDb.run(async (tx) => {
      await this.capacidad.asegurar(tx, MODULO, 'escritura');
      if (input.noShowRecallTypeId) {
        const tipo = await this.repo.buscarTipo(tx, input.noShowRecallTypeId);
        if (!tipo) throw new TipoRecallNoEncontradoError();
        // Configurar la reactivación con un tipo desactivado dejaría la
        // automatización muerta en silencio.
        if (!tipo.activo) throw new TipoRecallInactivoError(tipo.nombre);
      }
      const guardada = await this.repo.guardarConfiguracion(tx, input);
      await this.audit.record(tx, {
        entidad: 'RecallSettings',
        accion: 'editar',
        detalle: {
          reactivacionActiva: guardada.noShowRecallTypeId !== null,
          noShowDelayDays: guardada.noShowDelayDays,
        },
      });
      return guardada;
    });
  }
}
