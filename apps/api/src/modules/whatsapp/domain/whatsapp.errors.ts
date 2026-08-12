import { DomainError } from '../../../common/errors/domain.error';

/**
 * Encender los recordatorios con la configuración a medias dejaría a la clínica
 * creyendo que sus pacientes reciben avisos que en realidad fallan en silencio
 * en cada barrido. Es mejor no dejar activarlo.
 */
export class ConfigWhatsappIncompletaError extends DomainError {
  readonly code = 'ConfigWhatsappIncompleta';
  readonly httpStatus = 400;

  constructor(private readonly falta: string) {
    super(`No se puede activar los recordatorios: falta ${falta}`);
  }

  override details(): Record<string, unknown> {
    return { falta: this.falta };
  }
}

/** Modo 'propio' sin credenciales propias. Mismo CHECK que impone la base. */
export class CredencialesWhatsappFaltantesError extends DomainError {
  readonly code = 'CredencialesWhatsappFaltantes';
  readonly httpStatus = 400;

  constructor() {
    super(
      'Para usar un número propio hacen falta el phone_number_id y el access token de la clínica',
    );
  }
}

export class ZonaHorariaInvalidaError extends DomainError {
  readonly code = 'ZonaHorariaInvalida';
  readonly httpStatus = 400;

  constructor(zona: string) {
    super(`Zona horaria desconocida: ${zona}`);
  }
}

/**
 * El token del link de reagendado no sirve. No se distingue "no existe" de
 * "ya se usó" hacia afuera: la diferencia solo le sirve a quien está probando
 * tokens a ver cuál pega.
 */
export class TokenReagendaInvalidoError extends DomainError {
  readonly code = 'TokenReagendaInvalido';
  readonly httpStatus = 404;

  constructor() {
    super('Este enlace ya no es válido. Comunícate con tu clínica para reagendar.');
  }
}

/** La cita ya no admite reagendado (se canceló, ya pasó, o ya se atendió). */
export class CitaNoReagendableError extends DomainError {
  readonly code = 'CitaNoReagendable';
  readonly httpStatus = 409;

  constructor(estatus: string) {
    super(`Esta cita ya no se puede reagendar (estado: ${estatus})`);
  }
}

/** Confirmar solo tiene sentido mientras la cita sigue agendada. */
export class CitaNoConfirmableError extends DomainError {
  readonly code = 'CitaNoConfirmable';
  readonly httpStatus = 409;

  constructor(estatus: string) {
    super(`Una cita en estado "${estatus}" ya no se puede confirmar`);
  }
}
