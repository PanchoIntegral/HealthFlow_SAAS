import { Inject, Injectable } from '@nestjs/common';
import type {
  AbrirCajaRequest,
  ActualizarMovimientoCajaRequest,
  CerrarCajaRequest,
  RegistrarMovimientoCajaRequest,
  TurnoCajaResumen,
  TurnoCajaView,
} from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import { AuditService } from '../../../common/audit/audit.service';
import {
  PRESUPUESTO_REPOSITORY,
  type PresupuestoRepository,
} from '../../presupuestos/domain/presupuesto.repository';
import { PresupuestoNoEncontradoError } from '../../presupuestos/domain/presupuesto.errors';
import { TurnoCaja } from '../domain/turno-caja.entity';
import { CajaYaAbiertaError, NoHayCajaAbiertaError, TurnoCajaNoEncontradoError } from '../domain/caja.errors';
import {
  TURNO_CAJA_REPOSITORY,
  type RangoCortes,
  type TurnoCajaRepository,
} from '../domain/turno-caja.repository';

/**
 * Casos de uso de la caja. Todos corren dentro de una transacción con el
 * tenant fijado (RLS) y delegan las reglas a la entidad: aquí no se decide si
 * un turno admite cambios ni cómo se calcula el efectivo esperado.
 *
 * El dinero SIEMPRE se audita: abrir, cobrar, cancelar y cerrar dejan registro
 * de quién y cuándo, dentro de la misma transacción que el hecho que narran.
 */
@Injectable()
export class CajaUseCases {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    private readonly audit: AuditService,
    @Inject(TURNO_CAJA_REPOSITORY) private readonly repo: TurnoCajaRepository,
    @Inject(PRESUPUESTO_REPOSITORY) private readonly presupuestos: PresupuestoRepository,
  ) {}

  async abrir(dto: AbrirCajaRequest): Promise<TurnoCajaView> {
    return this.tenantDb.run(async (tx) => {
      // Comprobación amable; la garantía real es el índice único parcial de
      // la migración, que aguanta dos aperturas simultáneas.
      const abierto = await this.repo.findAbierto(tx);
      if (abierto) throw new CajaYaAbiertaError(abierto.id);

      const turno = TurnoCaja.abrir({
        abiertaPor: this.ctx.get().userId,
        fondoInicialCentavos: dto.fondoInicialCentavos,
        notas: dto.notas,
      });
      const id = await this.repo.abrir(tx, turno);

      await this.audit.record(tx, {
        entidad: 'caja_turno',
        entidadId: id,
        accion: 'abrir',
        detalle: { fondoInicialCentavos: dto.fondoInicialCentavos },
      });

      return (await this.repo.vistaDe(tx, id))!;
    });
  }

  /** El turno abierto, o `null` si la caja del día todavía no se abre. */
  cajaAbierta(): Promise<TurnoCajaView | null> {
    return this.tenantDb.run(async (tx) => {
      const turno = await this.repo.findAbierto(tx);
      return turno ? await this.repo.vistaDe(tx, turno.id) : null;
    });
  }

  obtenerTurno(id: string): Promise<TurnoCajaView> {
    return this.tenantDb.run(async (tx) => {
      const vista = await this.repo.vistaDe(tx, id);
      // RLS ya ocultó los de otras clínicas; si no hay fila, no existe aquí.
      if (!vista) throw new TurnoCajaNoEncontradoError();
      return vista;
    });
  }

  listarTurnos(rango: RangoCortes): Promise<TurnoCajaResumen[]> {
    return this.tenantDb.run((tx) => this.repo.listarTurnos(tx, rango));
  }

  /**
   * Registra una entrada o salida de dinero en el turno abierto.
   *
   * Si el cobro se liga a un presupuesto, además se registra el abono
   * correspondiente EN LA MISMA TRANSACCIÓN: tesorería y cobranza no pueden
   * quedar desfasadas ni un instante. Las reglas del abono (que el
   * presupuesto esté aceptado, que el monto quepa en el saldo) las sigue
   * poniendo el dominio de presupuestos, no este módulo.
   */
  async registrarMovimiento(dto: RegistrarMovimientoCajaRequest): Promise<TurnoCajaView> {
    return this.tenantDb.run(async (tx) => {
      const turno = await this.repo.findAbierto(tx);
      if (!turno) throw new NoHayCajaAbiertaError();

      // Solo un ingreso puede abonar a un presupuesto: un gasto o un retiro no
      // le pagan nada a nadie, así que ahí el vínculo se ignora.
      const ligaPresupuesto = dto.tipo === 'ingreso' ? dto.presupuestoId : undefined;
      const presupuesto = ligaPresupuesto
        ? await this.presupuestos.findById(tx, ligaPresupuesto)
        : null;
      if (ligaPresupuesto && !presupuesto) throw new PresupuestoNoEncontradoError();

      const movimiento = turno.registrarMovimiento({
        tipo: dto.tipo,
        concepto: dto.concepto,
        montoCentavos: dto.montoCentavos,
        metodo: dto.metodo,
        registradoPor: this.ctx.get().userId,
        // Si el cobro es de un presupuesto, el paciente se toma de ahí: pedirlo
        // otra vez solo abre la puerta a que lleguen distintos.
        patientId: dto.patientId ?? presupuesto?.toState().patientId ?? null,
        appointmentId: dto.appointmentId,
        presupuestoId: ligaPresupuesto ?? null,
        referencia: dto.referencia,
      });

      if (presupuesto) {
        const abono = presupuesto.registrarAbono({
          montoCentavos: dto.montoCentavos,
          metodo: dto.metodo,
          referencia: dto.referencia,
        });
        await this.presupuestos.guardar(tx, presupuesto);
        turno.ligarAbono(movimiento.id, abono.id);
      }

      await this.repo.guardar(tx, turno);
      await this.audit.record(tx, {
        entidad: 'caja_turno',
        entidadId: turno.id,
        accion: `movimiento_${dto.tipo}`,
        detalle: {
          movimientoId: movimiento.id,
          montoCentavos: movimiento.montoCentavos,
          metodo: movimiento.metodo,
          presupuestoId: movimiento.presupuestoId,
          abonoId: movimiento.abonoId,
        },
      });

      return (await this.repo.vistaDe(tx, turno.id))!;
    });
  }

  /** Corrección de captura sobre un movimiento del turno abierto. */
  async actualizarMovimiento(
    movimientoId: string,
    dto: ActualizarMovimientoCajaRequest,
  ): Promise<TurnoCajaView> {
    return this.conTurnoAbierto(async (tx, turno) => {
      const movimiento = turno.actualizarMovimiento(movimientoId, dto);
      await this.repo.guardar(tx, turno);
      await this.audit.record(tx, {
        entidad: 'caja_turno',
        entidadId: turno.id,
        accion: 'movimiento_editar',
        detalle: {
          movimientoId,
          montoCentavos: movimiento.montoCentavos,
          metodo: movimiento.metodo,
        },
      });
    });
  }

  async cancelarMovimiento(movimientoId: string, motivo: string): Promise<TurnoCajaView> {
    return this.conTurnoAbierto(async (tx, turno) => {
      turno.cancelarMovimiento(movimientoId, {
        motivo,
        canceladoPor: this.ctx.get().userId,
      });
      await this.repo.guardar(tx, turno);
      await this.audit.record(tx, {
        entidad: 'caja_turno',
        entidadId: turno.id,
        accion: 'movimiento_cancelar',
        detalle: { movimientoId, motivo },
      });
    });
  }

  /**
   * Cierra el turno con el efectivo contado. Devuelve el corte ya calculado
   * (incluida la diferencia contra lo esperado), que es el reporte del día.
   */
  async cerrar(dto: CerrarCajaRequest): Promise<TurnoCajaView> {
    return this.conTurnoAbierto(async (tx, turno) => {
      turno.cerrar({
        cerradaPor: this.ctx.get().userId,
        efectivoContadoCentavos: dto.efectivoContadoCentavos,
        notas: dto.notas,
      });
      await this.repo.guardar(tx, turno);

      const corte = turno.resumen;
      await this.audit.record(tx, {
        entidad: 'caja_turno',
        entidadId: turno.id,
        accion: 'cerrar',
        detalle: {
          ingresosCentavos: corte.ingresosCentavos,
          egresosCentavos: corte.egresosCentavos,
          retirosCentavos: corte.retirosCentavos,
          efectivoEsperadoCentavos: corte.efectivoEsperadoCentavos,
          efectivoContadoCentavos: corte.efectivoContadoCentavos,
          // El descuadre es EL dato del corte: se audita siempre, aunque sea 0.
          diferenciaCentavos: corte.diferenciaCentavos,
        },
      });
    });
  }

  /** Carga el turno abierto, aplica el cambio y devuelve la vista recalculada. */
  private conTurnoAbierto(
    accion: (
      tx: Parameters<Parameters<TenantDbService['run']>[0]>[0],
      turno: TurnoCaja,
    ) => Promise<void>,
  ): Promise<TurnoCajaView> {
    return this.tenantDb.run(async (tx) => {
      const turno = await this.repo.findAbierto(tx);
      if (!turno) throw new NoHayCajaAbiertaError();
      await accion(tx, turno);
      return (await this.repo.vistaDe(tx, turno.id))!;
    });
  }
}
