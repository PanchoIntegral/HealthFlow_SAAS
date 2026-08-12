import type { HorarioAtencion, WhatsappModo } from '@healthflow/shared-types';
import {
  ConfigWhatsappIncompletaError,
  CredencialesWhatsappFaltantesError,
  ZonaHorariaInvalidaError,
} from './whatsapp.errors';

/**
 * Configuración de recordatorios de una clínica.
 *
 * Las invariantes viven aquí y no en el DTO porque el DTO solo protege la
 * puerta HTTP: la base también las impone (CHECK de 0022), y esta entidad es
 * la que puede explicar en español qué falta cuando el titular intenta
 * encender los recordatorios sin haber terminado de configurarlos.
 */

export interface WhatsappConfigProps {
  tenantId: string;
  modo: WhatsappModo;
  wabaId: string | null;
  phoneNumberId: string | null;
  /** Ya cifrado: la entidad nunca ve el token en claro. */
  accessTokenCifrado: string | null;
  nombreRemitente: string | null;
  activo: boolean;
  horasAnticipacion: number;
  enviarConfirmacion: boolean;
  zonaHoraria: string;
  silencioDesde: number;
  silencioHasta: number;
  horarioAtencion: HorarioAtencion;
}

export const HORAS_ANTICIPACION_MIN = 1;
export const HORAS_ANTICIPACION_MAX = 168; // una semana

export class WhatsappConfig {
  private constructor(private readonly props: WhatsappConfigProps) {}

  /** Config por defecto de una clínica que nunca ha entrado a la pantalla. */
  static porDefecto(tenantId: string): WhatsappConfig {
    return new WhatsappConfig({
      tenantId,
      modo: 'compartido',
      wabaId: null,
      phoneNumberId: null,
      accessTokenCifrado: null,
      nombreRemitente: null,
      // Apagado: nadie empieza a mandar mensajes de pago sin decidirlo.
      activo: false,
      horasAnticipacion: 24,
      enviarConfirmacion: true,
      zonaHoraria: 'America/Mexico_City',
      silencioDesde: 21,
      silencioHasta: 8,
      horarioAtencion: { dias: [1, 2, 3, 4, 5], desde: '09:00', hasta: '18:00' },
    });
  }

  static fromState(props: WhatsappConfigProps): WhatsappConfig {
    return new WhatsappConfig({ ...props });
  }

  get tenantId(): string {
    return this.props.tenantId;
  }
  get modo(): WhatsappModo {
    return this.props.modo;
  }
  get activo(): boolean {
    return this.props.activo;
  }
  get accessTokenCifrado(): string | null {
    return this.props.accessTokenCifrado;
  }
  get phoneNumberId(): string | null {
    return this.props.phoneNumberId;
  }
  get wabaId(): string | null {
    return this.props.wabaId;
  }
  get nombreRemitente(): string | null {
    return this.props.nombreRemitente;
  }
  get horasAnticipacion(): number {
    return this.props.horasAnticipacion;
  }
  get enviarConfirmacion(): boolean {
    return this.props.enviarConfirmacion;
  }
  get zonaHoraria(): string {
    return this.props.zonaHoraria;
  }
  get silencioDesde(): number {
    return this.props.silencioDesde;
  }
  get silencioHasta(): number {
    return this.props.silencioHasta;
  }
  get horarioAtencion(): HorarioAtencion {
    return this.props.horarioAtencion;
  }

  /**
   * Aplica cambios parciales y revalida el conjunto. Devuelve una instancia
   * nueva para que un cambio rechazado no deje la anterior a medio modificar.
   */
  actualizar(cambios: Partial<Omit<WhatsappConfigProps, 'tenantId'>>): WhatsappConfig {
    const siguiente = new WhatsappConfig({ ...this.props, ...cambios });
    siguiente.validar();
    return siguiente;
  }

  private validar(): void {
    const p = this.props;

    if (p.modo === 'propio' && (!p.phoneNumberId || !p.accessTokenCifrado)) {
      throw new CredencialesWhatsappFaltantesError();
    }

    if (
      !Number.isInteger(p.horasAnticipacion) ||
      p.horasAnticipacion < HORAS_ANTICIPACION_MIN ||
      p.horasAnticipacion > HORAS_ANTICIPACION_MAX
    ) {
      throw new ConfigWhatsappIncompletaError(
        `una anticipación entre ${HORAS_ANTICIPACION_MIN} y ${HORAS_ANTICIPACION_MAX} horas`,
      );
    }

    for (const [nombre, hora] of [
      ['silencioDesde', p.silencioDesde],
      ['silencioHasta', p.silencioHasta],
    ] as const) {
      if (!Number.isInteger(hora) || hora < 0 || hora > 23) {
        throw new ConfigWhatsappIncompletaError(`una hora válida en ${nombre}`);
      }
    }

    if (!zonaHorariaValida(p.zonaHoraria)) {
      throw new ZonaHorariaInvalidaError(p.zonaHoraria);
    }

    validarHorario(p.horarioAtencion);

    // El nombre de la clínica va como variable del cuerpo de la plantilla
    // (el remitente dice "HealthFlow"), así que sin él el mensaje llegaría sin
    // decir de parte de quién.
    if (p.activo && !p.nombreRemitente?.trim()) {
      throw new ConfigWhatsappIncompletaError('el nombre con el que se identifica la clínica');
    }
  }
}

/** Rechaza una zona IANA que `Intl` no conozca: el cálculo del silencio la usa. */
export function zonaHorariaValida(zona: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validarHorario(horario: HorarioAtencion): void {
  if (!Array.isArray(horario.dias) || horario.dias.length === 0) {
    throw new ConfigWhatsappIncompletaError('al menos un día de atención');
  }
  if (horario.dias.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    throw new ConfigWhatsappIncompletaError('días de atención entre 1 (lunes) y 7 (domingo)');
  }
  if (!HH_MM.test(horario.desde) || !HH_MM.test(horario.hasta)) {
    throw new ConfigWhatsappIncompletaError('un horario en formato HH:MM');
  }
  if (horario.desde >= horario.hasta) {
    throw new ConfigWhatsappIncompletaError('un horario que termine después de empezar');
  }
}
