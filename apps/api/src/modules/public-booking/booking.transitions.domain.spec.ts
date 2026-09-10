import { decidePublicAction, rejectMessage, type PublicAction, type PublicAppointmentState } from './booking.transitions';

const now = new Date('2026-09-10T12:00:00Z');
const hours = (h: number) => new Date(now.getTime() + h * 3_600_000);
const policy = { now, limitHours: 24 };

function state(overrides: Partial<PublicAppointmentState> = {}): PublicAppointmentState {
  return { estatus: 'agendada', confirmacion: 'pendiente', startsAt: hours(72), ...overrides };
}

describe('máquina de estados de acciones públicas (P0.3)', () => {
  // Matriz mínima del plan. Cada fila es [estado, confirmar, cancelar, reprogramar].
  const table: [string, PublicAppointmentState, string, string, string][] = [
    ['agendada pendiente con margen', state(), 'apply', 'apply', 'apply'],
    ['agendada pendiente dentro del límite', state({ startsAt: hours(6) }), 'apply', 'reject:within_limit', 'reject:within_limit'],
    ['agendada confirmada con margen', state({ confirmacion: 'confirmada' }), 'noop', 'apply', 'apply'],
    ['cancelada', state({ estatus: 'cancelada', confirmacion: 'cancelada' }), 'reject:terminal', 'noop', 'reject:terminal'],
    ['finalizada', state({ estatus: 'finalizada', startsAt: hours(-48) }), 'reject:terminal', 'reject:terminal', 'reject:terminal'],
    ['no_asistio', state({ estatus: 'no_asistio', startsAt: hours(-48) }), 'reject:terminal', 'reject:terminal', 'reject:terminal'],
    ['en_espera', state({ estatus: 'en_espera', startsAt: hours(-0.25) }), 'reject:started', 'reject:started', 'reject:started'],
    ['en_consulta', state({ estatus: 'en_consulta', startsAt: hours(-0.5) }), 'reject:started', 'reject:started', 'reject:started'],
    ['agendada pero la hora ya pasó', state({ startsAt: hours(-1) }), 'reject:past', 'reject:past', 'reject:past'],
  ];

  const render = (s: PublicAppointmentState, a: PublicAction) => {
    const d = decidePublicAction(s, a, policy);
    return d.kind === 'reject' ? `reject:${d.reason}` : d.kind;
  };

  it.each(table)('%s', (_, s, confirm, cancel, reschedule) => {
    expect(render(s, 'confirm')).toBe(confirm);
    expect(render(s, 'cancel')).toBe(cancel);
    expect(render(s, 'reschedule')).toBe(reschedule);
  });

  it('confirmar dos veces es idempotente: la segunda no aplica nada', () => {
    expect(decidePublicAction(state(), 'confirm', policy)).toEqual({ kind: 'apply' });
    expect(decidePublicAction(state({ confirmacion: 'confirmada' }), 'confirm', policy)).toEqual({ kind: 'noop' });
  });

  it('cancelar dos veces es idempotente incluso dentro del límite', () => {
    const cancelled = state({ estatus: 'cancelada', confirmacion: 'cancelada', startsAt: hours(2) });
    expect(decidePublicAction(cancelled, 'cancel', policy)).toEqual({ kind: 'noop' });
  });

  it('el límite se mide contra la hora actual de la cita, no contra el destino', () => {
    expect(decidePublicAction(state({ startsAt: hours(24) }), 'reschedule', policy).kind).toBe('apply');
    expect(decidePublicAction(state({ startsAt: hours(23.9) }), 'reschedule', policy).kind).toBe('reject');
    expect(decidePublicAction(state({ startsAt: hours(0.5) }), 'reschedule', { now, limitHours: 0 }).kind).toBe('apply');
  });

  it('los mensajes de rechazo no revelan detalles de la cita', () => {
    for (const reason of ['terminal', 'started', 'past', 'within_limit'] as const) {
      for (const action of ['confirm', 'cancel', 'reschedule'] as const) {
        expect(rejectMessage(action, reason)).not.toMatch(/paciente|médico|doctor|servicio|diagn/i);
      }
    }
  });
});
