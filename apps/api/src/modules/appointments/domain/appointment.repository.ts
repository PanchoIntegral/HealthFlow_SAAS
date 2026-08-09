import type { AppointmentView, DoctorSummary, WaitingRoomEntry } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import type { Appointment } from './appointment.entity';

export interface NewAppointmentInput {
  patientId: string;
  doctorId: string;
  motivo: string | null;
  inicioProgramado: Date;
  finProgramado: Date;
}

/**
 * Puerto (interface) del repositorio de citas. El dominio/aplicación dependen
 * de esta abstracción, NO de Drizzle. El adaptador concreto vive en
 * infrastructure/. Todos los métodos reciben la transacción con tenant fijado.
 */
export interface AppointmentRepository {
  findById(tx: Tx, id: string): Promise<Appointment | null>;
  save(tx: Tx, appointment: Appointment): Promise<void>;

  /** Vista enriquecida para la sala de espera (citas activas del día). */
  listWaitingRoom(tx: Tx): Promise<WaitingRoomEntry[]>;
  /**
   * Con `soloHoy` devuelve null si la cita no es del día en curso: sirve para
   * no emitir por WebSocket citas que `listWaitingRoom` nunca devolvería.
   */
  findWaitingRoomEntry(
    tx: Tx,
    appointmentId: string,
    opts?: { soloHoy?: boolean },
  ): Promise<WaitingRoomEntry | null>;

  /** Agenda una cita nueva (estatus 'agendada') y devuelve su id. */
  create(tx: Tx, input: NewAppointmentInput): Promise<string>;

  /** Citas del rango [from, to], enriquecidas con nombres, para el calendario. */
  listByRange(tx: Tx, from: Date, to: Date): Promise<AppointmentView[]>;

  findView(tx: Tx, appointmentId: string): Promise<AppointmentView | null>;

  /** ¿El médico ya tiene una cita activa que se traslapa con ese horario? */
  hasOverlap(
    tx: Tx,
    doctorId: string,
    inicioProgramado: Date,
    finProgramado: Date,
    excludeAppointmentId?: string,
  ): Promise<boolean>;

  /** Médicos de la clínica activa, para el selector del formulario de cita. */
  listDoctors(tx: Tx): Promise<DoctorSummary[]>;
}

export const APPOINTMENT_REPOSITORY = Symbol('APPOINTMENT_REPOSITORY');
