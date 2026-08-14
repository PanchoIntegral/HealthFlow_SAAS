import { DomainError } from '../../../common/errors/domain.error';

/**
 * Ya hay un turno abierto en la clínica. Solo puede haber uno: dos cajas
 * abiertas a la vez reparten los cobros del día entre dos cortes y ninguno
 * cuadra. La base lo garantiza además con un índice único parcial
 * (ver 0022_caja.sql); este error existe para dar un mensaje entendible.
 */
export class CajaYaAbiertaError extends DomainError {
  readonly code = 'CajaYaAbierta';
  readonly httpStatus = 409;

  constructor(readonly turnoId: string) {
    super('Ya hay una caja abierta. Ciérrala antes de abrir una nueva.');
  }

  override details(): Record<string, unknown> {
    return { turnoId: this.turnoId };
  }
}

/** Se intentó cobrar (o cerrar) sin caja abierta. */
export class NoHayCajaAbiertaError extends DomainError {
  readonly code = 'NoHayCajaAbierta';
  readonly httpStatus = 409;

  constructor() {
    super('No hay una caja abierta. Abre la caja para registrar movimientos.');
  }
}

/**
 * El turno ya se cerró. Un corte firmado no se toca: si algo faltó, se
 * registra en el turno siguiente. Permitir movimientos retroactivos volvería
 * inútil el arqueo que ya se hizo contando el dinero.
 */
export class TurnoCajaCerradoError extends DomainError {
  readonly code = 'TurnoCajaCerrado';
  readonly httpStatus = 409;

  constructor() {
    super('El turno de caja ya está cerrado y no admite cambios.');
  }
}

export class TurnoCajaNoEncontradoError extends DomainError {
  readonly code = 'TurnoCajaNoEncontrado';
  readonly httpStatus = 404;

  constructor() {
    super('Turno de caja no encontrado');
  }
}

export class MovimientoCajaNoEncontradoError extends DomainError {
  readonly code = 'MovimientoCajaNoEncontrado';
  readonly httpStatus = 404;

  constructor() {
    super('Movimiento de caja no encontrado');
  }
}

/** Un movimiento cancelado ya no suma ni se vuelve a editar. */
export class MovimientoCajaCanceladoError extends DomainError {
  readonly code = 'MovimientoCajaCancelado';
  readonly httpStatus = 409;

  constructor() {
    super('El movimiento está cancelado.');
  }
}

/**
 * El movimiento generó un abono en un presupuesto, y los abonos son un
 * registro de cobranza que solo crece (ver presupuesto.drizzle-repo). Cambiar
 * aquí el monto —o cancelar el cobro— dejaría al paciente con un saldo que no
 * corresponde a lo que pagó. La corrección se hace con un movimiento nuevo.
 */
export class MovimientoLigadoAAbonoError extends DomainError {
  readonly code = 'MovimientoLigadoAAbono';
  readonly httpStatus = 409;

  constructor(readonly abonoId: string) {
    super(
      'Este cobro ya se aplicó como abono a un presupuesto: no se puede cambiar su monto ni cancelarlo. Registra un movimiento de ajuste.',
    );
  }

  override details(): Record<string, unknown> {
    return { abonoId: this.abonoId };
  }
}
