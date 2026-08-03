import type { NuevaPartida } from '@healthflow/shared-types';
import { Presupuesto } from './presupuesto.entity';
import {
  AbonoExcedeSaldoError,
  PresupuestoCongeladoError,
  PresupuestoNoAceptadoError,
  PresupuestoSinPartidasError,
  TransicionPresupuestoInvalidaError,
} from './presupuesto.errors';

/** Resina en el 16: 1 pieza a $1,200.00 = 120000 centavos. */
const RESINA: NuevaPartida = {
  descripcion: 'Resina compuesta',
  piezas: ['16'],
  fase: 1,
  cantidad: 1,
  valorUnitarioCentavos: 120000,
};

/** Endodoncia en el 26: $4,500.00 */
const ENDODONCIA: NuevaPartida = {
  descripcion: 'Endodoncia unirradicular',
  piezas: ['26'],
  fase: 2,
  cantidad: 1,
  valorUnitarioCentavos: 450000,
};

const nuevo = (partidas: NuevaPartida[] = [RESINA, ENDODONCIA]) =>
  Presupuesto.crear({ patientId: 'pac-1', doctorId: 'doc-1', titulo: 'Plan', partidas });

/** Atajo: presupuesto ya aceptado por el paciente. */
const aceptado = (partidas?: NuevaPartida[]) => {
  const p = nuevo(partidas);
  p.cambiarEstatus('presentado');
  p.cambiarEstatus('aceptado');
  return p;
};

describe('Presupuesto', () => {
  describe('totales derivados', () => {
    it('suma el importe de las partidas', () => {
      expect(nuevo().totalCentavos).toBe(570000);
    });

    it('deriva el importe de cantidad × valor unitario, sin aceptarlo del cliente', () => {
      const p = nuevo([{ ...RESINA, cantidad: 3 }]);
      expect(p.partidas[0]!.importeCentavos).toBe(360000);
      expect(p.totalCentavos).toBe(360000);
    });

    it('redondea al centavo con cantidades fraccionarias', () => {
      const p = nuevo([{ ...RESINA, cantidad: 1.5, valorUnitarioCentavos: 33333 }]);
      expect(p.partidas[0]!.importeCentavos).toBe(50000); // 49999.5 → 50000
    });

    it('excluye del total las partidas canceladas', () => {
      const p = nuevo();
      p.cambiarEstatusPartida(p.partidas[0]!.id, 'cancelada');
      expect(p.totalCentavos).toBe(450000);
    });

    it('arranca con saldo igual al total', () => {
      const p = nuevo();
      expect(p.abonadoCentavos).toBe(0);
      expect(p.saldoCentavos).toBe(570000);
    });
  });

  describe('máquina de estados', () => {
    it('recorre el camino normal hasta terminado', () => {
      const p = nuevo();
      p.cambiarEstatus('presentado');
      p.cambiarEstatus('aceptado');
      p.cambiarEstatus('terminado');
      expect(p.estatus).toBe('terminado');
    });

    it('no permite saltarse la presentación', () => {
      expect(() => nuevo().cambiarEstatus('aceptado')).toThrow(TransicionPresupuestoInvalidaError);
    });

    it('no permite revivir un presupuesto terminado', () => {
      const p = aceptado();
      p.cambiarEstatus('terminado');
      expect(() => p.cambiarEstatus('aceptado')).toThrow(TransicionPresupuestoInvalidaError);
    });

    it('deja regresar a borrador un presupuesto rechazado, para recotizar', () => {
      const p = nuevo();
      p.cambiarEstatus('presentado');
      p.cambiarEstatus('rechazado');
      p.cambiarEstatus('borrador');
      expect(p.estatus).toBe('borrador');
    });

    it('estampa la fecha al aceptar', () => {
      const ahora = new Date('2026-08-03T10:00:00.000Z');
      const p = nuevo();
      p.cambiarEstatus('presentado');
      p.cambiarEstatus('aceptado', ahora);
      expect(p.aceptadoEn).toEqual(ahora);
    });

    it('no deja presentar un presupuesto vacío', () => {
      expect(() => nuevo([]).cambiarEstatus('presentado')).toThrow(PresupuestoSinPartidasError);
    });
  });

  describe('congelamiento de precios tras aceptar', () => {
    // La regla que da valor al presupuesto como respaldo: si se pudiera
    // reescribir después de que el paciente lo aprobó, no probaría nada.
    it('permite editar partidas mientras es borrador', () => {
      const p = nuevo();
      p.reemplazarPartidas([RESINA]);
      expect(p.totalCentavos).toBe(120000);
    });

    it('bloquea la edición una vez aceptado', () => {
      expect(() => aceptado().reemplazarPartidas([RESINA])).toThrow(PresupuestoCongeladoError);
    });

    it('bloquea también en terminado y cancelado', () => {
      const terminado = aceptado();
      terminado.cambiarEstatus('terminado');
      expect(() => terminado.reemplazarPartidas([RESINA])).toThrow(PresupuestoCongeladoError);

      const cancelado = nuevo();
      cancelado.cambiarEstatus('cancelado');
      expect(() => cancelado.reemplazarPartidas([RESINA])).toThrow(PresupuestoCongeladoError);
    });

    it('SÍ deja avanzar el estatus de una partida aunque esté congelado', () => {
      // Marcar trabajo como hecho no altera lo que se cobra.
      const p = aceptado();
      p.cambiarEstatusPartida(p.partidas[0]!.id, 'terminado', 'cita-1');
      expect(p.partidas[0]!.estatus).toBe('terminado');
      expect(p.totalCentavos).toBe(570000);
    });
  });

  describe('abonos', () => {
    it('descuenta del saldo', () => {
      const p = aceptado();
      p.registrarAbono({ montoCentavos: 200000, metodo: 'efectivo' });
      expect(p.abonadoCentavos).toBe(200000);
      expect(p.saldoCentavos).toBe(370000);
    });

    it('acumula varios abonos hasta liquidar', () => {
      const p = aceptado();
      p.registrarAbono({ montoCentavos: 300000, metodo: 'transferencia' });
      p.registrarAbono({ montoCentavos: 270000, metodo: 'tarjeta' });
      expect(p.saldoCentavos).toBe(0);
    });

    it('rechaza el abono que excede el saldo, en vez de dejar saldo negativo', () => {
      const p = aceptado();
      p.registrarAbono({ montoCentavos: 500000, metodo: 'efectivo' });
      expect(() => p.registrarAbono({ montoCentavos: 100000, metodo: 'efectivo' })).toThrow(
        AbonoExcedeSaldoError,
      );
      expect(p.saldoCentavos).toBe(70000);
    });

    it('no deja abonar a un presupuesto que el paciente no ha aceptado', () => {
      expect(() => nuevo().registrarAbono({ montoCentavos: 1000, metodo: 'efectivo' })).toThrow(
        PresupuestoNoAceptadoError,
      );
    });

    it('usa la fecha de hoy si no se especifica', () => {
      const abono = aceptado().registrarAbono({ montoCentavos: 1000, metodo: 'efectivo' });
      expect(abono.fecha).toBe(new Date().toISOString().slice(0, 10));
    });
  });

  describe('puente con facturación', () => {
    it('devuelve solo las partidas terminadas de esa cita', () => {
      const p = aceptado();
      p.cambiarEstatusPartida(p.partidas[0]!.id, 'terminado', 'cita-1');
      p.cambiarEstatusPartida(p.partidas[1]!.id, 'en_proceso', 'cita-1');

      const facturables = p.partidasFacturablesDe('cita-1');
      expect(facturables).toHaveLength(1);
      expect(facturables[0]!.descripcion).toBe('Resina compuesta');
    });

    it('no mezcla el trabajo de otras citas', () => {
      const p = aceptado();
      p.cambiarEstatusPartida(p.partidas[0]!.id, 'terminado', 'cita-1');
      p.cambiarEstatusPartida(p.partidas[1]!.id, 'terminado', 'cita-2');
      expect(p.partidasFacturablesDe('cita-2')).toHaveLength(1);
      expect(p.partidasFacturablesDe('cita-3')).toHaveLength(0);
    });
  });
});
