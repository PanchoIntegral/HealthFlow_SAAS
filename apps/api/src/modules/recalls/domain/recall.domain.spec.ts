import { PatientRecall, cierraElSeguimiento, type ReglasRecall } from './recall.entity';
import {
  PacienteNoContactableError,
  RecallNoVencidoError,
  TransicionRecallInvalidaError,
} from './recall.errors';
import type { RecallStatus } from '@healthflow/shared-types';

const REGLAS: ReglasRecall = {
  intervalMonths: 6,
  maxAttempts: 3,
  attemptSpacingDays: 7,
  daysBeforeFirstContact: 0,
};

const AHORA = new Date('2026-09-11T17:00:00Z');

function crear(over: Partial<Parameters<typeof PatientRecall.crear>[0]> = {}): PatientRecall {
  return PatientRecall.crear({
    id: 'r1',
    patientId: 'p1',
    recallTypeId: 't1',
    source: 'procedimiento',
    fechaDelHecho: '2026-09-11',
    hoy: '2026-09-11',
    reglas: REGLAS,
    ...over,
  });
}

/** Lleva un control hasta el estado pedido por el camino legítimo. */
function en(status: RecallStatus): PatientRecall {
  const recall = crear({ fechaDelHecho: '2026-03-11' }); // vence hoy → 'due'
  if (status === 'due') return recall;
  if (status === 'pending') return crear();
  if (status === 'contacted') {
    recall.registrarContacto(REGLAS, AHORA);
    return recall;
  }
  if (status === 'scheduled') {
    recall.vincularCita('a1');
    return recall;
  }
  if (status === 'completed') {
    recall.vincularCita('a1');
    recall.completar(AHORA);
    return recall;
  }
  if (status === 'dismissed') {
    recall.descartar('Se mudó de ciudad');
    return recall;
  }
  // exhausted
  const agotar = { ...REGLAS, maxAttempts: 1 };
  recall.registrarContacto(agotar, AHORA);
  return recall;
}

describe('PatientRecall', () => {
  describe('nacimiento', () => {
    it('calcula el vencimiento sumando el intervalo a la fecha del HECHO', () => {
      const recall = crear({ fechaDelHecho: '2026-09-11' });
      expect(recall.snapshot.dueDate).toBe('2027-03-11');
      expect(recall.status).toBe('pending');
    });

    it('un evento reconciliado tarde no corre el vencimiento', () => {
      // El módulo estuvo apagado tres días; el evento se procesa hoy pero la
      // limpieza fue el día 8. El control vence seis meses después del día 8.
      const recall = crear({ fechaDelHecho: '2026-09-08', hoy: '2026-09-11' });
      expect(recall.snapshot.dueDate).toBe('2027-03-08');
    });

    it('si al reconciliar la fecha ya pasó, nace directamente vencido', () => {
      // Un tratamiento de hace ocho meses con control semestral: no tiene
      // sentido dejarlo 'pending' esperando un barrido.
      const recall = crear({ fechaDelHecho: '2026-01-11', hoy: '2026-09-11' });
      expect(recall.snapshot.dueDate).toBe('2026-07-11');
      expect(recall.status).toBe('due');
    });

    it('recorta el día al último del mes destino', () => {
      expect(crear({ fechaDelHecho: '2025-08-31' }).snapshot.dueDate).toBe('2026-02-28');
    });
  });

  describe('vencer', () => {
    it('el barrido lo pasa a due cuando llega la fecha', () => {
      const recall = crear({ fechaDelHecho: '2026-03-11' });
      expect(recall.status).toBe('due');
    });

    it('no vence antes de tiempo', () => {
      const recall = crear();
      expect(() => recall.vencer('2027-03-10')).toThrow(RecallNoVencidoError);
      recall.vencer('2027-03-11');
      expect(recall.status).toBe('due');
    });

    it('la anticipación del tipo adelanta la aparición en la lista', () => {
      const recall = crear();
      const conAnticipacion = { ...REGLAS, daysBeforeFirstContact: 14 };
      expect(() => recall.vencerCon(conAnticipacion, '2027-02-24')).toThrow(RecallNoVencidoError);
      recall.vencerCon(conAnticipacion, '2027-02-25');
      expect(recall.status).toBe('due');
    });

    it('es idempotente: dos barridos concurrentes no se pelean', () => {
      const recall = crear();
      recall.vencer('2027-03-11');
      expect(() => recall.vencer('2027-03-11')).not.toThrow();
      expect(recall.status).toBe('due');
    });

    it('un barrido no revive un control ya cerrado', () => {
      const completado = en('completed');
      completado.vencer('2030-01-01');
      expect(completado.status).toBe('completed');
    });
  });

  describe('contacto', () => {
    it('el primer intento lo pasa a contacted y agenda el siguiente', () => {
      const recall = en('due');
      recall.registrarContacto(REGLAS, AHORA);
      expect(recall.status).toBe('contacted');
      expect(recall.snapshot.intentos).toBe(1);
      expect(recall.snapshot.lastContactAt).toEqual(AHORA);
      // Siete días después, según la separación del tipo.
      expect(recall.snapshot.nextAttemptAt).toEqual(new Date('2026-09-18T17:00:00Z'));
    });

    it('al consumir el último intento pasa a exhausted, no se queda colgado', () => {
      const recall = en('due');
      recall.registrarContacto(REGLAS, AHORA);
      recall.registrarContacto(REGLAS, AHORA);
      expect(recall.status).toBe('contacted');
      recall.registrarContacto(REGLAS, AHORA);
      expect(recall.status).toBe('exhausted');
      // Y deja de pedir intentos: nadie va a volver a llamarlo.
      expect(recall.snapshot.nextAttemptAt).toBeNull();
    });

    it('un control agotado ya no acepta más contactos', () => {
      const recall = en('exhausted');
      expect(() => recall.registrarContacto(REGLAS, AHORA)).toThrow(TransicionRecallInvalidaError);
    });

    it('el número del siguiente intento sirve de clave única', () => {
      const recall = en('due');
      expect(recall.siguienteIntento()).toBe(1);
      recall.registrarContacto(REGLAS, AHORA);
      expect(recall.siguienteIntento()).toBe(2);
    });
  });

  describe('la cita cierra y reabre el seguimiento', () => {
    it('una cita compatible lo marca scheduled y corta el contacto automático', () => {
      const recall = en('contacted');
      recall.vincularCita('a1');
      expect(recall.status).toBe('scheduled');
      expect(recall.snapshot.appointmentId).toBe('a1');
      expect(recall.snapshot.nextAttemptAt).toBeNull();
    });

    it('el paciente puede reservar antes de que nadie lo llame', () => {
      const recall = crear();
      expect(recall.status).toBe('pending');
      recall.vincularCita('a1');
      expect(recall.status).toBe('scheduled');
    });

    it('cancelar sin reemplazo lo reactiva y suelta la cita', () => {
      const recall = en('scheduled');
      recall.reabrirPorCancelacion(false);
      expect(recall.status).toBe('due');
      expect(recall.snapshot.appointmentId).toBeNull();
    });

    it('una cita de reemplazo NO reactiva el contacto', () => {
      const recall = en('scheduled');
      recall.reabrirPorCancelacion(true);
      expect(recall.status).toBe('scheduled');
      expect(recall.snapshot.appointmentId).toBe('a1');
    });

    it('la cita realizada cierra el ciclo', () => {
      const recall = en('scheduled');
      recall.completar(AHORA);
      expect(recall.status).toBe('completed');
      expect(recall.snapshot.completedAt).toEqual(AHORA);
    });

    it('no se completa un control que nunca llegó a agendarse', () => {
      expect(() => en('due').completar(AHORA)).toThrow(TransicionRecallInvalidaError);
    });
  });

  describe('descarte', () => {
    it('exige un motivo', () => {
      const recall = en('due');
      expect(() => recall.descartar('   ')).toThrow(/hay que decir por qué/);
      recall.descartar('Ya no es paciente de la clínica');
      expect(recall.status).toBe('dismissed');
      expect(recall.snapshot.dismissReason).toBe('Ya no es paciente de la clínica');
    });

    it('recorta el motivo en vez de rechazarlo', () => {
      const recall = en('due');
      recall.descartar('x'.repeat(400));
      expect(recall.snapshot.dismissReason).toHaveLength(280);
    });

    it('un control cerrado no se vuelve a descartar', () => {
      expect(() => en('completed').descartar('tarde')).toThrow(TransicionRecallInvalidaError);
    });
  });

  describe('estados terminales', () => {
    it.each(['completed', 'dismissed', 'exhausted'] as const)('%s no admite nada más', (status) => {
      const recall = en(status);
      expect(recall.vivo).toBe(false);
      expect(() => recall.vincularCita('a2')).toThrow(TransicionRecallInvalidaError);
      expect(() => recall.reabrirPorCancelacion(false)).toThrow(TransicionRecallInvalidaError);
    });

    it.each(['pending', 'due', 'contacted', 'scheduled'] as const)('%s ocupa el cupo', (status) => {
      expect(en(status).vivo).toBe(true);
    });
  });

  describe('elección de canal', () => {
    const base = {
      archivado: false,
      email: 'ana@correo.mx',
      emailSuprimido: false,
      telefono: '+526861234567',
      whatsappOptIn: true,
      canalPreferido: null as 'whatsapp' | 'email' | 'ninguno' | null,
    };

    it('respeta la preferencia del paciente cuando es utilizable', () => {
      expect(PatientRecall.elegirCanal({ ...base, canalPreferido: 'whatsapp' })).toBe('whatsapp');
      expect(PatientRecall.elegirCanal({ ...base, canalPreferido: 'email' })).toBe('email');
    });

    it('NUNCA infiere el consentimiento de WhatsApp', () => {
      // Hay teléfono, pero nadie autorizó el canal.
      const sinOptIn = { ...base, whatsappOptIn: false, email: null, canalPreferido: 'whatsapp' as const };
      expect(PatientRecall.elegirCanal(sinOptIn)).toBe('phone');
    });

    it('sin canal digital devuelve una tarea de llamada, no un error', () => {
      // Es lo que permite operar sin Twilio ni dominio de correo verificado.
      expect(
        PatientRecall.elegirCanal({ ...base, email: null, whatsappOptIn: false }),
      ).toBe('phone');
    });

    it('un correo suprimido por rebote no se vuelve a usar', () => {
      expect(
        PatientRecall.elegirCanal({ ...base, emailSuprimido: true, whatsappOptIn: false }),
      ).toBe('phone');
    });

    it('sin preferencia utilizable prefiere correo sobre WhatsApp', () => {
      // El correo no depende de una plantilla aprobada ni de la ventana de 24 h.
      expect(PatientRecall.elegirCanal(base)).toBe('email');
    });

    it('un paciente archivado no se contacta por ningún canal', () => {
      expect(() => PatientRecall.elegirCanal({ ...base, archivado: true })).toThrow(
        PacienteNoContactableError,
      );
    });

    it('quien pidió no recibir mensajes tampoco recibe una llamada automática', () => {
      expect(() => PatientRecall.elegirCanal({ ...base, canalPreferido: 'ninguno' })).toThrow(
        /no recibir mensajes/,
      );
    });
  });

  it('reservar y declinar cierran el seguimiento; no contestar no', () => {
    expect(cierraElSeguimiento('booked')).toBe(true);
    expect(cierraElSeguimiento('declined')).toBe(true);
    expect(cierraElSeguimiento('unreachable')).toBe(false);
    expect(cierraElSeguimiento('sent')).toBe(false);
  });
});
