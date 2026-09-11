import {
  capacidadEfectiva,
  estaDisponible,
  permite,
  razonDe,
  type EntradaCapacidad,
} from './capacidad';
import type { RazonNoDisponible } from '@healthflow/shared-types';

const AHORA = new Date('2026-09-11T12:00:00Z');

const TODO_BIEN: EntradaCapacidad = {
  suscripcionVigente: true,
  entitlement: { estado: 'active', vigenciaHasta: null },
  rollout: true,
  configuracion: true,
};

const con = (over: Partial<EntradaCapacidad>): EntradaCapacidad => ({ ...TODO_BIEN, ...over });

describe('Capacidad efectiva sobre un módulo', () => {
  it('los cuatro ejes en verde dan acceso completo', () => {
    const capacidad = capacidadEfectiva(TODO_BIEN, AHORA);
    expect(capacidad).toEqual({ acceso: 'completo' });
    expect(permite(capacidad, 'lectura')).toBe(true);
    expect(permite(capacidad, 'escritura')).toBe(true);
    expect(estaDisponible(capacidad)).toBe(true);
    expect(razonDe(capacidad)).toBeNull();
  });

  describe('tabla de verdad: cada eje apagado por su cuenta', () => {
    const casos: [string, Partial<EntradaCapacidad>, RazonNoDisponible, 'ninguno' | 'solo_lectura'][] = [
      ['sin contratar', { entitlement: null }, 'entitlement', 'ninguno'],
      ['en rollback', { rollout: false }, 'rollout', 'ninguno'],
      ['el titular no lo activó', { configuracion: false }, 'configuracion', 'ninguno'],
      ['suscripción vencida', { suscripcionVigente: false }, 'suscripcion', 'solo_lectura'],
    ];
    it.each(casos)('%s → %s (%s)', (_d, parche, razon, acceso) => {
      expect(capacidadEfectiva(con(parche), AHORA)).toEqual({ acceso, razon });
    });
  });

  describe('leer y escribir no son la misma pregunta', () => {
    it('con el pago atrasado se consulta pero no se registra', () => {
      // Misma decisión que ya gobierna el expediente clínico: la cobranza no
      // le quita a un médico el acceso a la información de sus pacientes.
      const capacidad = capacidadEfectiva(con({ suscripcionVigente: false }), AHORA);
      expect(permite(capacidad, 'lectura')).toBe(true);
      expect(permite(capacidad, 'escritura')).toBe(false);
      // Y sin embargo NO cuenta como disponible: la UI no debe ofrecerlo como
      // si funcionara del todo.
      expect(estaDisponible(capacidad)).toBe(false);
    });

    it('un módulo sin contratar no se lee ni se escribe', () => {
      const capacidad = capacidadEfectiva(con({ entitlement: null }), AHORA);
      expect(permite(capacidad, 'lectura')).toBe(false);
      expect(permite(capacidad, 'escritura')).toBe(false);
    });
  });

  it('la suscripción se evalúa AL FINAL: primero hay que tener el módulo', () => {
    // Si fuera antes, a quien no contrató el módulo le diríamos "regulariza tu
    // pago" por algo que de todos modos no compró.
    expect(
      capacidadEfectiva(
        con({ entitlement: null, suscripcionVigente: false, rollout: false, configuracion: false }),
        AHORA,
      ),
    ).toEqual({ acceso: 'ninguno', razon: 'entitlement' });
    expect(
      capacidadEfectiva(con({ suscripcionVigente: false, configuracion: false }), AHORA),
    ).toEqual({ acceso: 'ninguno', razon: 'configuracion' });
  });

  describe('estados del derecho contratado', () => {
    it('una prueba vigente habilita igual que una compra', () => {
      expect(
        capacidadEfectiva(con({ entitlement: { estado: 'trialing', vigenciaHasta: null } }), AHORA),
      ).toEqual({ acceso: 'completo' });
    });

    it('suspendido y vencido NO habilitan', () => {
      for (const estado of ['suspended', 'expired'] as const) {
        expect(capacidadEfectiva(con({ entitlement: { estado, vigenciaHasta: null } }), AHORA)).toEqual(
          { acceso: 'ninguno', razon: 'entitlement' },
        );
      }
    });

    it('un derecho con vigencia cumplida deja de habilitar en el instante exacto', () => {
      const vencido = { estado: 'trialing' as const, vigenciaHasta: AHORA };
      expect(capacidadEfectiva(con({ entitlement: vencido }), AHORA)).toEqual({
        acceso: 'ninguno',
        razon: 'entitlement',
      });
      const porUnSegundo = {
        estado: 'trialing' as const,
        vigenciaHasta: new Date(AHORA.getTime() + 1000),
      };
      expect(capacidadEfectiva(con({ entitlement: porUnSegundo }), AHORA)).toEqual({
        acceso: 'completo',
      });
    });

    it('sin vigencia declarada el derecho no caduca solo', () => {
      expect(
        capacidadEfectiva(con({ entitlement: { estado: 'active', vigenciaHasta: null } }), AHORA),
      ).toEqual({ acceso: 'completo' });
    });
  });

  it('no depende del reloj del sistema', () => {
    // El mismo dato evaluado en dos instantes distintos sólo cambia por la
    // vigencia, nunca por `new Date()` escondido dentro de la función.
    const entrada = con({ entitlement: { estado: 'active', vigenciaHasta: new Date('2026-10-01') } });
    expect(estaDisponible(capacidadEfectiva(entrada, new Date('2026-09-30')))).toBe(true);
    expect(estaDisponible(capacidadEfectiva(entrada, new Date('2026-10-02')))).toBe(false);
  });
});
