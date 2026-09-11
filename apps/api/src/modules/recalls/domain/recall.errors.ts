import { DomainError } from '../../../common/errors/domain.error';
import type { RecallStatus } from '@healthflow/shared-types';

/** Transición que la máquina de estados no admite. */
export class TransicionRecallInvalidaError extends DomainError {
  readonly code = 'TransicionRecallInvalida';
  readonly httpStatus = 409;

  constructor(
    readonly desde: RecallStatus,
    readonly hacia: RecallStatus,
    readonly motivo?: string,
  ) {
    super(
      motivo ??
        `Un control en estado '${desde}' no puede pasar a '${hacia}'.`,
    );
  }

  details(): Record<string, unknown> {
    return { desde: this.desde, hacia: this.hacia };
  }
}

/** Se intentó vencer un control cuya fecha todavía no llega. */
export class RecallNoVencidoError extends DomainError {
  readonly code = 'RecallNoVencido';
  readonly httpStatus = 409;

  constructor(readonly dueDate: string) {
    super(`Este control vence el ${dueDate}; todavía no toca.`);
  }

  details(): Record<string, unknown> {
    return { dueDate: this.dueDate };
  }
}

/** Un paciente archivado no se contacta. */
export class PacienteNoContactableError extends DomainError {
  readonly code = 'PacienteNoContactable';
  readonly httpStatus = 409;

  constructor(readonly razon: 'archivado' | 'sin_canal' | 'opt_out') {
    super(MENSAJES[razon]);
  }

  details(): Record<string, unknown> {
    return { razon: this.razon };
  }
}

const MENSAJES: Record<'archivado' | 'sin_canal' | 'opt_out', string> = {
  archivado: 'El expediente de este paciente está archivado.',
  sin_canal: 'Este paciente no tiene un canal de contacto autorizado.',
  opt_out: 'Este paciente pidió no recibir mensajes.',
};
