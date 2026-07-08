/**
 * Contratos compartidos entre `apps/web` (Next.js) y `apps/api` (NestJS).
 * Definir la forma de las entidades UNA sola vez: si algo se desincroniza
 * entre frontend y backend, TypeScript marca el error en ambos lados.
 */

// ── Roles y RBAC ─────────────────────────────────────────────────
export const USER_ROLES = ['medico', 'asistente', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

// ── Máquina de estados de la cita ────────────────────────────────
export const APPOINTMENT_STATUSES = [
  'agendada',
  'en_espera',
  'en_consulta',
  'finalizada',
  'cancelada',
  'no_asistio',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

// ── Entidades ────────────────────────────────────────────────────
export interface Patient {
  id: string;
  tenantId: string;
  nombre: string;
  fechaNacimiento: string; // ISO date (YYYY-MM-DD)
  curp: string | null;
  telefono: string | null;
}

export interface Appointment {
  id: string;
  tenantId: string;
  patientId: string;
  doctorId: string;
  inicioProgramado: string; // ISO datetime
  finProgramado: string; // ISO datetime
  estatus: AppointmentStatus;
  checkinAt: string | null;
  inicioReal: string | null;
  finReal: string | null;
}

/**
 * Vista enriquecida de una cita para la sala de espera: la cita + los datos
 * del paciente que la UI necesita mostrar en la tarjeta.
 */
export interface WaitingRoomEntry {
  appointmentId: string;
  patientId: string;
  patientNombre: string;
  patientEdad: number;
  estatus: AppointmentStatus;
  motivo: string | null;
  inicioProgramado: string;
  checkinAt: string | null;
}

// ── Eventos WebSocket (sala de espera en tiempo real) ────────────
export const WAITING_ROOM_EVENTS = {
  /** El servidor emite esto cuando una cita cambia de estado. */
  APPOINTMENT_UPDATED: 'appointment.updated',
} as const;

export interface AppointmentUpdatedEvent {
  entry: WaitingRoomEntry;
  previousStatus: AppointmentStatus | null;
}

// ── DTOs de API ──────────────────────────────────────────────────
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  user: {
    id: string;
    tenantId: string;
    nombre: string;
    rol: UserRole;
  };
}
