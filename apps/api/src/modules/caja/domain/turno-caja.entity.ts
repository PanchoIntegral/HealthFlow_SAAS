import { randomUUID } from 'node:crypto';
import type {
  MetodoPago,
  MovimientoCaja,
  ResumenCaja,
  TipoMovimientoCaja,
} from '@healthflow/shared-types';
import {
  MovimientoCajaCanceladoError,
  MovimientoCajaNoEncontradoError,
  MovimientoLigadoAAbonoError,
  TurnoCajaCerradoError,
} from './caja.errors';

export interface TurnoCajaProps {
  id: string;
  abiertaPor: string;
  fondoInicialCentavos: number;
  abiertaEn: Date;
  notasApertura: string | null;
  cerradaPor: string | null;
  cerradaEn: Date | null;
  efectivoContadoCentavos: number | null;
  notasCierre: string | null;
  movimientos: MovimientoCaja[];
}

export interface NuevoMovimiento {
  tipo: TipoMovimientoCaja;
  concepto: string;
  montoCentavos: number;
  metodo: MetodoPago;
  registradoPor: string;
  patientId?: string | null;
  appointmentId?: string | null;
  presupuestoId?: string | null;
  referencia?: string | null;
}

const METODOS_VACIOS: Record<MetodoPago, number> = {
  efectivo: 0,
  tarjeta: 0,
  transferencia: 0,
  otro: 0,
};

/**
 * Turno de caja. Es el agregado del módulo: el turno y sus movimientos se
 * abren, se editan y se cierran juntos, y ninguna regla del corte tiene
 * sentido fuera de él.
 *
 * Concentra lo que no puede vivir en la base de datos: que un turno cerrado no
 * admite nada más, que un cobro ya aplicado a un presupuesto no se puede
 * mover, y cómo se calcula el efectivo esperado. Pura y testeable sin Postgres.
 *
 * Todos los montos en CENTAVOS enteros, igual que facturación y presupuestos.
 */
export class TurnoCaja {
  private constructor(private readonly props: TurnoCajaProps) {}

  static abrir(input: {
    abiertaPor: string;
    fondoInicialCentavos: number;
    notas?: string | null;
    id?: string;
    ahora?: Date;
  }): TurnoCaja {
    return new TurnoCaja({
      id: input.id ?? randomUUID(),
      abiertaPor: input.abiertaPor,
      fondoInicialCentavos: input.fondoInicialCentavos,
      abiertaEn: input.ahora ?? new Date(),
      notasApertura: input.notas ?? null,
      cerradaPor: null,
      cerradaEn: null,
      efectivoContadoCentavos: null,
      notasCierre: null,
      movimientos: [],
    });
  }

  static fromState(props: TurnoCajaProps): TurnoCaja {
    return new TurnoCaja({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get abierta(): boolean {
    return this.props.cerradaEn === null;
  }
  get movimientos(): MovimientoCaja[] {
    return this.props.movimientos;
  }

  /** Movimientos que cuentan para el corte: los cancelados quedan fuera. */
  private get vigentes(): MovimientoCaja[] {
    return this.props.movimientos.filter((m) => m.canceladoEn === null);
  }

  registrarMovimiento(input: NuevoMovimiento, ahora: Date = new Date()): MovimientoCaja {
    this.assertAbierta();

    const movimiento: MovimientoCaja = {
      id: randomUUID(),
      tipo: input.tipo,
      concepto: input.concepto,
      montoCentavos: input.montoCentavos,
      // Un retiro es sacar billetes del cajón: no existe "retirar con tarjeta".
      // Se normaliza aquí en vez de rechazarlo para no castigar al usuario por
      // un campo que en su caso no tiene alternativa (la base lo exige igual).
      metodo: input.tipo === 'retiro' ? 'efectivo' : input.metodo,
      patientId: input.patientId ?? null,
      appointmentId: input.appointmentId ?? null,
      presupuestoId: input.presupuestoId ?? null,
      abonoId: null,
      referencia: input.referencia ?? null,
      registradoPor: input.registradoPor,
      createdAt: ahora.toISOString(),
      canceladoEn: null,
      canceladoPor: null,
      motivoCancelacion: null,
    };
    this.props.movimientos.push(movimiento);
    return movimiento;
  }

  /**
   * Amarra el cobro con el abono que generó en el presupuesto. A partir de
   * aquí el movimiento queda congelado en monto (ver `actualizarMovimiento`).
   */
  ligarAbono(movimientoId: string, abonoId: string): void {
    this.buscar(movimientoId).abonoId = abonoId;
  }

  /**
   * Corrección de captura. El TIPO nunca cambia —un ingreso no se vuelve
   * egreso, eso es otro movimiento— y el monto queda congelado si el cobro ya
   * se aplicó como abono a un presupuesto.
   */
  actualizarMovimiento(
    movimientoId: string,
    cambios: {
      concepto?: string;
      montoCentavos?: number;
      metodo?: MetodoPago;
      referencia?: string | null;
    },
  ): MovimientoCaja {
    this.assertAbierta();
    const m = this.buscar(movimientoId);
    if (m.canceladoEn !== null) throw new MovimientoCajaCanceladoError();

    const tocaElDinero =
      (cambios.montoCentavos !== undefined && cambios.montoCentavos !== m.montoCentavos) ||
      (cambios.metodo !== undefined && cambios.metodo !== m.metodo);
    if (tocaElDinero && m.abonoId) throw new MovimientoLigadoAAbonoError(m.abonoId);

    if (cambios.concepto !== undefined) m.concepto = cambios.concepto;
    if (cambios.montoCentavos !== undefined) m.montoCentavos = cambios.montoCentavos;
    if (cambios.metodo !== undefined && m.tipo !== 'retiro') m.metodo = cambios.metodo;
    if (cambios.referencia !== undefined) m.referencia = cambios.referencia;
    return m;
  }

  /**
   * Cancelación LÓGICA: el movimiento se queda en el corte, marcado y sin
   * sumar. No se borra porque el corte de caja es un documento contable y
   * tiene que poder explicar qué se capturó de más y quién lo canceló.
   */
  cancelarMovimiento(
    movimientoId: string,
    input: { motivo: string; canceladoPor: string },
    ahora: Date = new Date(),
  ): MovimientoCaja {
    this.assertAbierta();
    const m = this.buscar(movimientoId);
    if (m.canceladoEn !== null) throw new MovimientoCajaCanceladoError();
    if (m.abonoId) throw new MovimientoLigadoAAbonoError(m.abonoId);

    m.canceladoEn = ahora.toISOString();
    m.canceladoPor = input.canceladoPor;
    m.motivoCancelacion = input.motivo;
    return m;
  }

  cerrar(input: {
    cerradaPor: string;
    efectivoContadoCentavos: number;
    notas?: string | null;
    ahora?: Date;
  }): void {
    this.assertAbierta();
    this.props.cerradaPor = input.cerradaPor;
    this.props.cerradaEn = input.ahora ?? new Date();
    this.props.efectivoContadoCentavos = input.efectivoContadoCentavos;
    this.props.notasCierre = input.notas ?? null;
  }

  /**
   * El corte. Todo derivado de los movimientos vigentes; nada se almacena.
   *
   * El efectivo esperado solo mira el dinero en EFECTIVO: lo cobrado con
   * tarjeta o transferencia nunca pasó por el cajón, así que incluirlo haría
   * que todos los cortes salieran cuadrados por accidente.
   */
  get resumen(): ResumenCaja {
    const ingresosPorMetodo = { ...METODOS_VACIOS };
    let ingresos = 0;
    let egresos = 0;
    let retiros = 0;
    let efectivo = this.props.fondoInicialCentavos;

    for (const m of this.vigentes) {
      switch (m.tipo) {
        case 'ingreso':
          ingresos += m.montoCentavos;
          ingresosPorMetodo[m.metodo] += m.montoCentavos;
          if (m.metodo === 'efectivo') efectivo += m.montoCentavos;
          break;
        case 'egreso':
          egresos += m.montoCentavos;
          if (m.metodo === 'efectivo') efectivo -= m.montoCentavos;
          break;
        case 'retiro':
          retiros += m.montoCentavos;
          efectivo -= m.montoCentavos;
          break;
      }
    }

    const contado = this.props.efectivoContadoCentavos;
    return {
      fondoInicialCentavos: this.props.fondoInicialCentavos,
      ingresosCentavos: ingresos,
      egresosCentavos: egresos,
      retirosCentavos: retiros,
      ingresosPorMetodo,
      efectivoEsperadoCentavos: efectivo,
      efectivoContadoCentavos: contado,
      diferenciaCentavos: contado === null ? null : contado - efectivo,
    };
  }

  private buscar(movimientoId: string): MovimientoCaja {
    const m = this.props.movimientos.find((x) => x.id === movimientoId);
    if (!m) throw new MovimientoCajaNoEncontradoError();
    return m;
  }

  private assertAbierta(): void {
    if (!this.abierta) throw new TurnoCajaCerradoError();
  }

  toState(): TurnoCajaProps {
    return { ...this.props };
  }
}
