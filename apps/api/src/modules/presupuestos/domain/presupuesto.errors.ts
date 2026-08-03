import { DomainError } from '../../../common/errors/domain.error';

/** Transición no permitida por la máquina de estados del presupuesto. */
export class TransicionPresupuestoInvalidaError extends DomainError {
  readonly code = 'TransicionPresupuestoInvalida';
  readonly httpStatus = 409;

  constructor(
    readonly desde: string,
    readonly hacia: string,
  ) {
    super(`Transición de presupuesto inválida: ${desde} → ${hacia}`);
  }

  override details(): Record<string, unknown> {
    return { desde: this.desde, hacia: this.hacia };
  }
}

/**
 * Se intentó modificar las partidas de un presupuesto que el paciente ya
 * aceptó. Los precios quedan congelados al aceptar: un presupuesto que se
 * puede reescribir después de aprobado no sirve como respaldo de nada. Para
 * cambiar algo hay que cancelar la partida y crear otra, quedando las dos en
 * el histórico.
 */
export class PresupuestoCongeladoError extends DomainError {
  readonly code = 'PresupuestoCongelado';
  readonly httpStatus = 409;

  constructor(readonly estatus: string) {
    super(
      `El presupuesto está en estatus "${estatus}" y sus partidas ya no pueden modificarse. Cancela la partida y crea una nueva.`,
    );
  }

  override details(): Record<string, unknown> {
    return { estatus: this.estatus };
  }
}

/** Un presupuesto sin partidas no se puede presentar ni aceptar. */
export class PresupuestoSinPartidasError extends DomainError {
  readonly code = 'PresupuestoSinPartidas';
  readonly httpStatus = 422;

  constructor() {
    super('El presupuesto debe tener al menos una partida');
  }
}

/**
 * El abono supera el saldo pendiente. Se rechaza en vez de permitir saldo
 * negativo: un "sobrepago" casi siempre es un dedazo en el monto, y dejarlo
 * pasar convierte el estado de cuenta en algo que nadie puede explicar.
 */
export class AbonoExcedeSaldoError extends DomainError {
  readonly code = 'AbonoExcedeSaldo';
  readonly httpStatus = 422;

  constructor(
    readonly saldoCentavos: number,
    readonly montoCentavos: number,
  ) {
    super('El abono supera el saldo pendiente del presupuesto');
  }

  override details(): Record<string, unknown> {
    return { saldoCentavos: this.saldoCentavos, montoCentavos: this.montoCentavos };
  }
}

/** Solo se puede abonar a un presupuesto que el paciente aceptó. */
export class PresupuestoNoAceptadoError extends DomainError {
  readonly code = 'PresupuestoNoAceptado';
  readonly httpStatus = 409;

  constructor(readonly estatus: string) {
    super(`No se puede registrar un abono: el presupuesto está en "${estatus}", no aceptado`);
  }
}

export class PresupuestoNoEncontradoError extends DomainError {
  readonly code = 'PresupuestoNoEncontrado';
  readonly httpStatus = 404;

  constructor() {
    super('Presupuesto no encontrado');
  }
}
