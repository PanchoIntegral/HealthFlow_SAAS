import { cuposDisponibles, limitesDePlan, LIMITES_PLAN } from '@healthflow/shared-types';

/**
 * Los cupos del plan son la promesa de la página de precios convertida en
 * regla: aquí se prueba la aritmética pura, sin base de datos. Que la API la
 * cobre de verdad se prueba en los tests de integración.
 */
describe('Cupos del plan', () => {
  describe('limitesDePlan', () => {
    it('Individual: 1 médico, 1 asistente y 300 pacientes', () => {
      const limites = limitesDePlan('individual');
      expect(limites.maxMedicos).toBe(1);
      expect(limites.maxAsistentes).toBe(1);
      expect(limites.maxPacientes).toBe(300);
    });

    it('Consultorio: 5 médicos y pacientes ilimitados', () => {
      const limites = limitesDePlan('consultorio');
      expect(limites.maxMedicos).toBe(5);
      expect(limites.maxPacientes).toBeNull();
    });

    it('un plan desconocido cae al más chico, nunca al más grande', () => {
      // Regalar capacidad por un valor inesperado en la columna `plan` sería
      // el peor default posible: se cobra Individual y se entrega Clínica.
      expect(limitesDePlan('plan_que_no_existe')).toEqual(LIMITES_PLAN.individual);
      expect(limitesDePlan(null)).toEqual(LIMITES_PLAN.individual);
      expect(limitesDePlan(undefined)).toEqual(LIMITES_PLAN.individual);
    });

    it('traduce los planes heredados anteriores al self-serve', () => {
      expect(limitesDePlan('pro')).toEqual(LIMITES_PLAN.consultorio);
      expect(limitesDePlan('free')).toEqual(LIMITES_PLAN.individual);
    });
  });

  describe('cuposDisponibles', () => {
    it('en Individual, el titular ya ocupa el único asiento de médico', () => {
      const cupos = cuposDisponibles(LIMITES_PLAN.individual!, 1, 0);
      expect(cupos.medicosDisponibles).toBe(0);
      expect(cupos.puedeAgregarMedico).toBe(false);
      // Pero el asistente NO consume asiento de médico: va aparte.
      expect(cupos.puedeAgregarAsistente).toBe(true);
    });

    it('en Consultorio, el titular deja 4 asientos para otros médicos', () => {
      const cupos = cuposDisponibles(LIMITES_PLAN.consultorio!, 1, 0);
      expect(cupos.medicosDisponibles).toBe(4);
      expect(cupos.puedeAgregarMedico).toBe(true);
    });

    it('con el cupo lleno no deja agregar', () => {
      const cupos = cuposDisponibles(LIMITES_PLAN.consultorio!, 5, 1);
      expect(cupos.puedeAgregarMedico).toBe(false);
      expect(cupos.puedeAgregarAsistente).toBe(false);
    });

    it('nunca reporta cupo negativo aunque se haya rebasado el plan', () => {
      // Pasa de verdad: una cuenta que bajó de Consultorio a Individual sigue
      // teniendo 3 médicos activos. Se bloquea el alta, no se muestra "-2".
      const cupos = cuposDisponibles(LIMITES_PLAN.individual!, 3, 0);
      expect(cupos.medicosDisponibles).toBe(0);
      expect(cupos.puedeAgregarMedico).toBe(false);
    });

    it('sin límite (plan Clínica) siempre deja agregar', () => {
      const cupos = cuposDisponibles(LIMITES_PLAN.clinica!, 40, 12);
      expect(cupos.medicosDisponibles).toBeNull();
      expect(cupos.puedeAgregarMedico).toBe(true);
      expect(cupos.puedeAgregarAsistente).toBe(true);
    });
  });
});
