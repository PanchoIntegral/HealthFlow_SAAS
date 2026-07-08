import type { WaitingRoomEntry } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import type { Appointment } from './appointment.entity';

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
  findWaitingRoomEntry(tx: Tx, appointmentId: string): Promise<WaitingRoomEntry | null>;
}

export const APPOINTMENT_REPOSITORY = Symbol('APPOINTMENT_REPOSITORY');
