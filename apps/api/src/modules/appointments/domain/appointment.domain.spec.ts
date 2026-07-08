import { Appointment, ALLOWED_TRANSITIONS } from './appointment.entity';
import { InvalidAppointmentTransitionError } from './appointment.errors';
import type { AppointmentProps } from './appointment.entity';
import type { AppointmentStatus } from '@healthflow/shared-types';

function make(estatus: AppointmentStatus): Appointment {
  const props: AppointmentProps = {
    id: '00000000-0000-0000-0000-000000000001',
    tenantId: 't',
    patientId: 'p',
    doctorId: 'd',
    estatus,
    checkinAt: null,
    inicioReal: null,
    finReal: null,
  };
  return Appointment.fromState(props);
}

describe('Appointment (máquina de estados de dominio)', () => {
  describe('check-in: agendada → en_espera', () => {
    it('transiciona y registra checkinAt', () => {
      const appt = make('agendada');
      const now = new Date('2026-07-04T10:00:00Z');
      appt.checkIn(now);
      expect(appt.estatus).toBe('en_espera');
      expect(appt.checkinAt).toEqual(now);
    });

    it('rechaza check-in si no está agendada', () => {
      expect(() => make('en_consulta').checkIn()).toThrow(InvalidAppointmentTransitionError);
      expect(() => make('finalizada').checkIn()).toThrow(InvalidAppointmentTransitionError);
    });
  });

  describe('estados terminales: ninguna salida', () => {
    it.each(['finalizada', 'cancelada', 'no_asistio'] as const)(
      '%s no permite ninguna transición',
      (terminal) => {
        expect(ALLOWED_TRANSITIONS[terminal]).toHaveLength(0);
        const appt = make(terminal);
        expect(() => appt.checkIn()).toThrow(InvalidAppointmentTransitionError);
        expect(() => appt.startConsultation()).toThrow(InvalidAppointmentTransitionError);
        expect(() => appt.finish()).toThrow(InvalidAppointmentTransitionError);
        expect(() => appt.cancel()).toThrow(InvalidAppointmentTransitionError);
      },
    );
  });

  describe('flujo feliz completo', () => {
    it('agendada → en_espera → en_consulta → finalizada', () => {
      const appt = make('agendada');
      appt.checkIn();
      expect(appt.estatus).toBe('en_espera');
      appt.startConsultation();
      expect(appt.estatus).toBe('en_consulta');
      appt.finish();
      expect(appt.estatus).toBe('finalizada');
    });
  });

  describe('ramas de excepción', () => {
    it('agendada → cancelada', () => {
      const appt = make('agendada');
      appt.cancel();
      expect(appt.estatus).toBe('cancelada');
    });

    it('en_espera → no_asistio', () => {
      const appt = make('en_espera');
      appt.markNoShow();
      expect(appt.estatus).toBe('no_asistio');
    });

    it('el error de transición nombra el from y el to', () => {
      try {
        make('finalizada').checkIn();
        fail('debió lanzar');
      } catch (err) {
        const e = err as InvalidAppointmentTransitionError;
        expect(e.from).toBe('finalizada');
        expect(e.to).toBe('en_espera');
      }
    });
  });
});
