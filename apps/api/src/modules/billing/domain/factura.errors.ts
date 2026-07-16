import { DomainError } from '../../../common/errors/domain.error';

/** El RFC no cumple el formato del SAT (12 posiciones moral / 13 física). */
export class RfcInvalidoError extends DomainError {
  readonly code = 'RfcInvalido';
  readonly httpStatus = 422;

  constructor(readonly rfc: string) {
    super('El RFC no tiene un formato válido');
  }
}

/** Se intentó crear una factura sin conceptos. */
export class FacturaSinConceptosError extends DomainError {
  readonly code = 'FacturaSinConceptos';
  readonly httpStatus = 422;

  constructor() {
    super('Una factura debe tener al menos un concepto');
  }
}

/** Transición de estatus no permitida por la máquina de estados del CFDI. */
export class TransicionFacturaInvalidaError extends DomainError {
  readonly code = 'TransicionFacturaInvalida';
  readonly httpStatus = 409;

  constructor(
    readonly desde: string,
    readonly hacia: string,
  ) {
    super(`Transición de factura inválida: ${desde} → ${hacia}`);
  }

  override details(): Record<string, unknown> {
    return { desde: this.desde, hacia: this.hacia };
  }
}

/** Ya existe una factura viva (PENDIENTE o TIMBRADA) para esa cita. */
export class FacturaYaEmitidaError extends DomainError {
  readonly code = 'FacturaYaEmitida';
  readonly httpStatus = 409;

  constructor() {
    super('Ya existe una factura activa para esta cita');
  }
}

export class FacturaNoEncontradaError extends DomainError {
  readonly code = 'FacturaNoEncontrada';
  readonly httpStatus = 404;

  constructor() {
    super('Factura no encontrada');
  }
}

/** El tenant no tiene configurados sus datos fiscales de emisor. */
export class EmisorNoConfiguradoError extends DomainError {
  readonly code = 'EmisorNoConfigurado';
  readonly httpStatus = 422;

  constructor() {
    super('La clínica no tiene configurados sus datos fiscales de emisor');
  }
}

/**
 * Fallo al timbrar con el PAC. El mensaje hacia el cliente es genérico a
 * propósito: el detalle crudo del PAC (URLs, IDs de cuenta, trazas) se loguea
 * solo del lado del servidor.
 */
export class PacTimbradoError extends DomainError {
  readonly code = 'PacTimbrado';
  readonly httpStatus = 502;

  constructor() {
    super('El proveedor de timbrado no está disponible o rechazó la factura');
  }
}

export class PacCancelacionError extends DomainError {
  readonly code = 'PacCancelacion';
  readonly httpStatus = 502;

  constructor() {
    super('El proveedor de timbrado no pudo procesar la cancelación');
  }
}
