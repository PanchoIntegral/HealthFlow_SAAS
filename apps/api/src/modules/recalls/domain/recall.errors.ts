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

/** El control pedido no existe, o es de otra clínica (RLS no lo deja ver). */
export class RecallNoEncontradoError extends DomainError {
  readonly code = 'RecallNoEncontrado';
  readonly httpStatus = 404;
  constructor() {
    super('Ese control de seguimiento no existe.');
  }
}

export class TipoRecallNoEncontradoError extends DomainError {
  readonly code = 'TipoRecallNoEncontrado';
  readonly httpStatus = 404;
  constructor() {
    super('Ese tipo de control no existe.');
  }
}

/** Se intentó usar un tipo desactivado para crear algo nuevo. */
export class TipoRecallInactivoError extends DomainError {
  readonly code = 'TipoRecallInactivo';
  readonly httpStatus = 409;
  constructor(readonly nombre: string) {
    super(`El tipo de control '${nombre}' está desactivado.`);
  }
}

/** Ya existe un tipo activo con ese nombre en la clínica. */
export class TipoRecallDuplicadoError extends DomainError {
  readonly code = 'TipoRecallDuplicado';
  readonly httpStatus = 409;
  constructor(readonly nombre: string) {
    super(`Ya existe un tipo de control activo llamado '${nombre}'.`);
  }
}

/**
 * La reactivación por inasistencia no está configurada.
 *
 * Es un ESTADO, no un error de programación: el consumidor lo trata como
 * "no hay nada que hacer" y cierra el evento. Nunca se inventa un tipo.
 */
export class ReactivacionNoConfiguradaError extends DomainError {
  readonly code = 'ReactivacionNoConfigurada';
  readonly httpStatus = 409;
  constructor() {
    super('Esta clínica no configuró el seguimiento por inasistencia.');
  }
}

/**
 * Ya existe un intento con ese número. Lo produce el índice único
 * (recall, attempt_number) cuando dos procesos reclaman el mismo control a la
 * vez: el segundo se entera aquí, no creando un intento duplicado.
 */
export class IntentoYaRegistradoError extends DomainError {
  readonly code = 'IntentoYaRegistrado';
  readonly httpStatus = 409;
  constructor(readonly numero: number) {
    super(`El intento ${numero} de este control ya estaba registrado.`);
  }
}

/**
 * Ya hay una gestión en curso para este control.
 *
 * Evita el caso real: recepción hace doble clic en "contactar" y al paciente
 * le llegan dos mensajes idénticos. La restricción de unicidad protege los
 * datos, pero no evita el segundo envío — eso lo evita esta regla.
 */
export class IntentoEnCursoError extends DomainError {
  readonly code = 'IntentoEnCurso';
  readonly httpStatus = 409;
  constructor() {
    super('Ya hay una gestión en curso para este control. Regístrala antes de hacer otra.');
  }
}

/**
 * No se pudo cerrar el intento: no existe, no pertenece a ese control, o ya
 * estaba cerrado o cancelado.
 *
 * Una sola causa hacia afuera a propósito. Distinguirlas exigiría una consulta
 * extra y no cambiaría lo que el usuario debe hacer —recargar y mirar el
 * estado real—, mientras que el `UPDATE` que no toca ninguna fila ya trae la
 * respuesta. Lo que NO puede pasar es que un cierre fallido devuelva 200: eso
 * dejaría a recepción creyendo que registró una gestión que no quedó.
 */
export class IntentoNoActualizableError extends DomainError {
  readonly code = 'IntentoNoActualizable';
  readonly httpStatus = 409;
  constructor() {
    super(
      'No se pudo registrar el resultado: esa gestión ya no está abierta o no es de este control.',
    );
  }
}
