import { Appointment, ALLOWED_TRANSITIONS } from './appointment.entity';
import {
  AusenciaPrematuraError,
  InvalidAppointmentRangeError,
  InvalidAppointmentTransitionError,
} from './appointment.errors';
import type { AppointmentProps } from './appointment.entity';
import type { AppointmentStatus } from '@healthflow/shared-types';

/** Fin previsto de la cita de prueba; la tolerancia cuenta desde aquí. */
const FIN = new Date('2026-09-12T18:00:00Z');
/** Ya pasada la tolerancia de 30 minutos. */
const DESPUES = new Date('2026-09-12T18:31:00Z');

function make(estatus: AppointmentStatus, finProgramado: Date = FIN): Appointment {
  const props: AppointmentProps = {
    id: '00000000-0000-0000-0000-000000000001',
    tenantId: 't',
    patientId: 'p',
    doctorId: 'd',
    estatus,
    finProgramado,
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
      appt.markNoShow(DESPUES);
      expect(appt.estatus).toBe('no_asistio');
    });

    it('agendada → no_asistio: el caso típico es quien nunca se registró', () => {
      const appt = make('agendada');
      appt.markNoShow(DESPUES);
      expect(appt.estatus).toBe('no_asistio');
    });

    describe('la tolerancia antes de marcar una ausencia', () => {
      it('rechaza marcarla mientras corre la tolerancia, y dice desde cuándo', () => {
        // Sin esta regla, un dedazo en la sala de espera marca como ausente a
        // quien va llegando — y esa ausencia dispara un seguimiento y un
        // mensaje al paciente que está sentado ahí.
        const appt = make('agendada');
        try {
          appt.markNoShow(new Date('2026-09-12T18:29:00Z'));
          fail('debió lanzar');
        } catch (err) {
          const e = err as AusenciaPrematuraError;
          expect(e.code).toBe('AusenciaPrematura');
          expect(e.httpStatus).toBe(409);
          expect(e.details()).toEqual({ allowedAt: '2026-09-12T18:30:00.000Z' });
        }
        // Y la cita no se movió: un error no deja estado a medias.
        expect(appt.estatus).toBe('agendada');
      });

      it('justo al cumplirse la tolerancia ya procede', () => {
        const appt = make('agendada');
        appt.markNoShow(new Date('2026-09-12T18:30:00.000Z'));
        expect(appt.estatus).toBe('no_asistio');
      });

      it('acepta otro umbral cuando la clínica cierra más tarde', () => {
        const appt = make('agendada');
        expect(() => appt.markNoShow(DESPUES, 120)).toThrow(AusenciaPrematuraError);
        appt.markNoShow(new Date('2026-09-12T20:01:00Z'), 120);
        expect(appt.estatus).toBe('no_asistio');
      });

      it('expone desde cuándo se permite, para que la UI no tenga que calcularlo', () => {
        expect(make('agendada').ausenciaPermitidaDesde()).toEqual(
          new Date('2026-09-12T18:30:00.000Z'),
        );
      });

      it('un estado que no admite la transición falla por transición, no por hora', () => {
        // A quien sigue en consulta hay que decirle que el estado no
        // corresponde; a quien acaba de empezar, que todavía no es hora.
        try {
          make('en_consulta').markNoShow(DESPUES);
          fail('debió lanzar');
        } catch (err) {
          expect(err).toBeInstanceOf(InvalidAppointmentTransitionError);
        }
      });

      it('tampoco resucita una cita ya cerrada, ni con el tiempo cumplido', () => {
        for (const estatus of ['finalizada', 'cancelada', 'no_asistio'] as const) {
          expect(() => make(estatus).markNoShow(DESPUES)).toThrow(
            InvalidAppointmentTransitionError,
          );
        }
      });
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

  describe('validación de horario (agendar)', () => {
    it('acepta un rango donde el fin es posterior al inicio', () => {
      expect(() =>
        Appointment.assertValidRange(new Date('2026-07-10T10:00:00Z'), new Date('2026-07-10T10:30:00Z')),
      ).not.toThrow();
    });

    it('rechaza el rango si el fin es igual al inicio', () => {
      const d = new Date('2026-07-10T10:00:00Z');
      expect(() => Appointment.assertValidRange(d, d)).toThrow(InvalidAppointmentRangeError);
    });

    it('rechaza el rango si el fin es anterior al inicio', () => {
      expect(() =>
        Appointment.assertValidRange(new Date('2026-07-10T10:30:00Z'), new Date('2026-07-10T10:00:00Z')),
      ).toThrow(InvalidAppointmentRangeError);
    });
  });
});
