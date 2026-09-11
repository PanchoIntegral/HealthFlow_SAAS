import { capacidadEfectiva, bloqueaLecturaHttp, type EntradaCapacidad } from './capacidad';
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
  it('los cuatro ejes en verde dan disponible', () => {
    expect(capacidadEfectiva(TODO_BIEN, AHORA)).toEqual({ disponible: true });
  });

  describe('tabla de verdad: cada eje apagado por su cuenta', () => {
    const casos: [string, Partial<EntradaCapacidad>, RazonNoDisponible][] = [
      ['sin contratar', { entitlement: null }, 'entitlement'],
      ['suscripción vencida', { suscripcionVigente: false }, 'suscripcion'],
      ['en rollback', { rollout: false }, 'rollout'],
      ['el titular no lo activó', { configuracion: false }, 'configuracion'],
    ];
    it.each(casos)('%s → %s', (_d, parche, razon) => {
      expect(capacidadEfectiva(con(parche), AHORA)).toEqual({ disponible: false, razon });
    });
  });

  it('con varios ejes apagados gana el entitlement: es la conversación de ventas', () => {
    // A quien no contrató el módulo no le sirve enterarse de que además su
    // suscripción venció; primero tiene que comprarlo.
    expect(
      capacidadEfectiva(
        con({ entitlement: null, suscripcionVigente: false, rollout: false, configuracion: false }),
        AHORA,
      ),
    ).toEqual({ disponible: false, razon: 'entitlement' });
  });

  describe('estados del derecho contratado', () => {
    it('una prueba vigente habilita igual que una compra', () => {
      expect(
        capacidadEfectiva(con({ entitlement: { estado: 'trialing', vigenciaHasta: null } }), AHORA)
          .disponible,
      ).toBe(true);
    });

    it('suspendido y vencido NO habilitan', () => {
      for (const estado of ['suspended', 'expired'] as const) {
        expect(capacidadEfectiva(con({ entitlement: { estado, vigenciaHasta: null } }), AHORA)).toEqual(
          { disponible: false, razon: 'entitlement' },
        );
      }
    });

    it('un derecho con vigencia cumplida deja de habilitar en el instante exacto', () => {
      const vencido = { estado: 'trialing' as const, vigenciaHasta: AHORA };
      expect(capacidadEfectiva(con({ entitlement: vencido }), AHORA)).toEqual({
        disponible: false,
        razon: 'entitlement',
      });
      const porUnSegundo = {
        estado: 'trialing' as const,
        vigenciaHasta: new Date(AHORA.getTime() + 1000),
      };
      expect(capacidadEfectiva(con({ entitlement: porUnSegundo }), AHORA).disponible).toBe(true);
    });

    it('sin vigencia declarada el derecho no caduca solo', () => {
      expect(
        capacidadEfectiva(con({ entitlement: { estado: 'active', vigenciaHasta: null } }), AHORA)
          .disponible,
      ).toBe(true);
    });
  });

  describe('qué bloquea cada razón en HTTP', () => {
    it('la suscripción NO bloquea lecturas: eso es del 402 y sólo en escrituras', () => {
      expect(bloqueaLecturaHttp('suscripcion')).toBe(false);
    });

    it('las otras tres sí ocultan el módulo por completo', () => {
      for (const razon of ['entitlement', 'rollout', 'configuracion'] as const) {
        expect(bloqueaLecturaHttp(razon)).toBe(true);
      }
    });
  });

  it('no depende del reloj del sistema', () => {
    // El mismo dato evaluado en dos instantes distintos sólo cambia por la
    // vigencia, nunca por `new Date()` escondido dentro de la función.
    const entrada = con({ entitlement: { estado: 'active', vigenciaHasta: new Date('2026-10-01') } });
    expect(capacidadEfectiva(entrada, new Date('2026-09-30')).disponible).toBe(true);
    expect(capacidadEfectiva(entrada, new Date('2026-10-02')).disponible).toBe(false);
  });
});
