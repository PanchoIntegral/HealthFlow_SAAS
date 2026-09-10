import type { AppointmentStatus, ConfirmationStatus } from '@healthflow/shared-types';

/**
 * Máquina de estados de las acciones públicas sobre una cita (P0.3).
 *
 * Es una función pura: sin Nest, sin base de datos, sin reloj implícito. El
 * servicio sólo traduce la decisión a SQL. La tabla de pruebas en
 * `booking.transitions.domain.spec.ts` es la especificación.
 *
 *   Estado actual          | Confirmar  | Cancelar            | Reprogramar
 *   -----------------------|------------|---------------------|---------------------
 *   agendada, pendiente    | aplica     | aplica si hay margen| aplica si hay margen
 *   agendada, confirmada   | sin cambio | aplica si hay margen| aplica; vuelve a pendiente
 *   en_espera / en_consulta| rechaza    | rechaza             | rechaza
 *   cancelada              | rechaza    | sin cambio          | rechaza
 *   finalizada / no_asistio| rechaza    | rechaza             | rechaza
 *   agendada pero ya pasó  | rechaza    | rechaza             | rechaza
 */
export type PublicAction = 'confirm' | 'cancel' | 'reschedule';

export interface PublicAppointmentState {
  estatus: AppointmentStatus;
  confirmacion: ConfirmationStatus;
  startsAt: Date;
}

export interface TransitionPolicy {
  now: Date;
  /** Horas mínimas de anticipación para cancelar o reprogramar (`limite_cancelacion_horas`). */
  limitHours: number;
}

export type RejectReason = 'terminal' | 'started' | 'past' | 'within_limit';

export type TransitionDecision =
  | { kind: 'apply' }
  /** Idempotente: la cita ya está en el estado pedido. Se devuelve el resumen sin registrar evento. */
  | { kind: 'noop' }
  | { kind: 'reject'; reason: RejectReason };

const TERMINAL: ReadonlySet<AppointmentStatus> = new Set(['cancelada', 'finalizada', 'no_asistio']);
const STARTED: ReadonlySet<AppointmentStatus> = new Set(['en_espera', 'en_consulta']);

export function decidePublicAction(state: PublicAppointmentState, action: PublicAction, policy: TransitionPolicy): TransitionDecision {
  if (state.estatus === 'cancelada') {
    return action === 'cancel' ? { kind: 'noop' } : { kind: 'reject', reason: 'terminal' };
  }
  if (TERMINAL.has(state.estatus)) return { kind: 'reject', reason: 'terminal' };
  if (STARTED.has(state.estatus)) return { kind: 'reject', reason: 'started' };
  // Sigue `agendada` pero la hora ya pasó: recepción debe cerrarla; el
  // paciente ya no puede administrarla.
  if (state.startsAt.getTime() <= policy.now.getTime()) return { kind: 'reject', reason: 'past' };

  switch (action) {
    case 'confirm':
      return state.confirmacion === 'confirmada' ? { kind: 'noop' } : { kind: 'apply' };
    case 'cancel':
    case 'reschedule':
      return withinLimit(state.startsAt, policy) ? { kind: 'reject', reason: 'within_limit' } : { kind: 'apply' };
  }
}

function withinLimit(startsAt: Date, policy: TransitionPolicy): boolean {
  return startsAt.getTime() - policy.now.getTime() < policy.limitHours * 3_600_000;
}

/** Mensaje al paciente por motivo de rechazo. Genérico a propósito: no revela más de lo necesario. */
export function rejectMessage(action: PublicAction, reason: RejectReason): string {
  switch (reason) {
    case 'terminal': return 'Esta cita ya no puede modificarse. Si necesitas una nueva, agenda otra vez.';
    case 'started': return 'La cita ya está en curso; comunícate con la clínica.';
    case 'past': return 'La hora de la cita ya pasó; comunícate con la clínica.';
    case 'within_limit':
      return action === 'cancel'
        ? 'La cita ya está dentro del límite de cancelación; comunícate con la clínica'
        : 'La cita ya está dentro del límite de reprogramación';
  }
}
