import { Inject, Injectable } from '@nestjs/common';
import type {
  CrearPresupuestoRequest,
  EstatusPartida,
  EstatusPresupuesto,
  NuevaPartida,
  PresupuestoView,
  RegistrarAbonoRequest,
  SaldosPorCobrar,
} from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import { AuditService } from '../../../common/audit/audit.service';
import { Presupuesto } from '../domain/presupuesto.entity';
import { PresupuestoNoEncontradoError } from '../domain/presupuesto.errors';
import {
  PRESUPUESTO_REPOSITORY,
  type PresupuestoRepository,
} from '../domain/presupuesto.repository';

/**
 * Casos de uso del presupuesto. Todos corren dentro de una transacción con el
 * tenant fijado (RLS) y delegan las reglas a la entidad: aquí no se decide qué
 * transición es válida ni si un abono cabe en el saldo.
 */
@Injectable()
export class PresupuestosUseCases {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    private readonly audit: AuditService,
    @Inject(PRESUPUESTO_REPOSITORY) private readonly repo: PresupuestoRepository,
  ) {}

  async crear(dto: CrearPresupuestoRequest): Promise<PresupuestoView> {
    return this.tenantDb.run(async (tx) => {
      const presupuesto = Presupuesto.crear({
        patientId: dto.patientId,
        doctorId: this.ctx.get().userId,
        titulo: dto.titulo,
        notas: dto.notas,
        vigenciaHasta: dto.vigenciaHasta,
        partidas: dto.partidas,
      });
      const id = await this.repo.crear(tx, presupuesto);

      await this.audit.record(tx, {
        entidad: 'presupuesto',
        entidadId: id,
        accion: 'crear',
        detalle: { patientId: dto.patientId, partidas: dto.partidas.length },
      });

      return (await this.repo.vistaDe(tx, id))!;
    });
  }

  listarPorPaciente(patientId: string): Promise<PresupuestoView[]> {
    return this.tenantDb.run((tx) => this.repo.listarPorPaciente(tx, patientId));
  }

  listarTodos(estatus?: EstatusPresupuesto[]): Promise<PresupuestoView[]> {
    return this.tenantDb.run((tx) => this.repo.listarTodos(tx, estatus));
  }

  async obtener(id: string): Promise<PresupuestoView> {
    return this.tenantDb.run(async (tx) => {
      const vista = await this.repo.vistaDe(tx, id);
      // RLS ya ocultó los de otras clínicas; si no hay fila, no existe aquí.
      if (!vista) throw new PresupuestoNoEncontradoError();
      return vista;
    });
  }

  async reemplazarPartidas(id: string, partidas: NuevaPartida[]): Promise<PresupuestoView> {
    return this.conPresupuesto(id, async (tx, presupuesto) => {
      presupuesto.reemplazarPartidas(partidas);
      await this.repo.guardar(tx, presupuesto);
    });
  }

  async cambiarEstatus(id: string, estatus: EstatusPresupuesto): Promise<PresupuestoView> {
    return this.conPresupuesto(id, async (tx, presupuesto) => {
      presupuesto.cambiarEstatus(estatus);
      await this.repo.guardar(tx, presupuesto);
      await this.audit.record(tx, {
        entidad: 'presupuesto',
        entidadId: id,
        accion: `estatus_${estatus}`,
        detalle: { totalCentavos: presupuesto.totalCentavos },
      });
    });
  }

  async cambiarEstatusPartida(
    id: string,
    partidaId: string,
    estatus: EstatusPartida,
    appointmentId?: string,
  ): Promise<PresupuestoView> {
    return this.conPresupuesto(id, async (tx, presupuesto) => {
      presupuesto.cambiarEstatusPartida(partidaId, estatus, appointmentId);
      await this.repo.guardar(tx, presupuesto);
    });
  }

  async registrarAbono(id: string, dto: RegistrarAbonoRequest): Promise<PresupuestoView> {
    return this.conPresupuesto(id, async (tx, presupuesto) => {
      const abono = presupuesto.registrarAbono({
        montoCentavos: dto.montoCentavos,
        metodo: dto.metodo,
        fecha: dto.fecha,
        referencia: dto.referencia,
      });
      await this.repo.guardar(tx, presupuesto);
      // El dinero que entra se audita siempre: quién lo registró y cuándo.
      await this.audit.record(tx, {
        entidad: 'presupuesto',
        entidadId: id,
        accion: 'abono',
        detalle: {
          abonoId: abono.id,
          montoCentavos: abono.montoCentavos,
          metodo: abono.metodo,
          saldoResultante: presupuesto.saldoCentavos,
        },
      });
    });
  }

  saldosPorCobrar(): Promise<SaldosPorCobrar> {
    return this.tenantDb.run((tx) => this.repo.saldosPorCobrar(tx));
  }

  /** Carga, aplica el cambio de dominio y devuelve la vista ya recalculada. */
  private async conPresupuesto(
    id: string,
    accion: (tx: Parameters<Parameters<TenantDbService['run']>[0]>[0], p: Presupuesto) => Promise<void>,
  ): Promise<PresupuestoView> {
    return this.tenantDb.run(async (tx) => {
      const presupuesto = await this.repo.findById(tx, id);
      if (!presupuesto) throw new PresupuestoNoEncontradoError();
      await accion(tx, presupuesto);
      return (await this.repo.vistaDe(tx, id))!;
    });
  }
}
