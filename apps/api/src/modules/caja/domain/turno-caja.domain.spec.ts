import { TurnoCaja } from './turno-caja.entity';
import {
  MovimientoCajaCanceladoError,
  MovimientoCajaNoEncontradoError,
  MovimientoLigadoAAbonoError,
  TurnoCajaCerradoError,
} from './caja.errors';

/** Fondo de cambio típico de una recepción: $500.00 */
const FONDO = 50_000;

const abrir = (fondo = FONDO) =>
  TurnoCaja.abrir({ abiertaPor: 'user-1', fondoInicialCentavos: fondo });

const cobrar = (
  turno: TurnoCaja,
  montoCentavos: number,
  metodo: 'efectivo' | 'tarjeta' | 'transferencia' | 'otro' = 'efectivo',
) =>
  turno.registrarMovimiento({
    tipo: 'ingreso',
    concepto: 'Consulta',
    montoCentavos,
    metodo,
    registradoPor: 'user-1',
  });

describe('TurnoCaja', () => {
  describe('apertura', () => {
    it('arranca abierto, sin movimientos y con el efectivo esperado igual al fondo', () => {
      const turno = abrir();
      expect(turno.abierta).toBe(true);
      expect(turno.movimientos).toHaveLength(0);
      expect(turno.resumen.efectivoEsperadoCentavos).toBe(FONDO);
      // Sin cierre no hay descuadre que reportar.
      expect(turno.resumen.efectivoContadoCentavos).toBeNull();
      expect(turno.resumen.diferenciaCentavos).toBeNull();
    });
  });

  describe('corte', () => {
    it('suma los ingresos y los desglosa por método', () => {
      const turno = abrir();
      cobrar(turno, 80_000, 'efectivo');
      cobrar(turno, 120_000, 'tarjeta');

      const { resumen } = turno;
      expect(resumen.ingresosCentavos).toBe(200_000);
      expect(resumen.ingresosPorMetodo.efectivo).toBe(80_000);
      expect(resumen.ingresosPorMetodo.tarjeta).toBe(120_000);
      expect(resumen.ingresosPorMetodo.transferencia).toBe(0);
    });

    /** El punto del desglose: lo cobrado con tarjeta nunca pasó por el cajón. */
    it('solo el efectivo entra al efectivo esperado', () => {
      const turno = abrir();
      cobrar(turno, 80_000, 'efectivo');
      cobrar(turno, 120_000, 'tarjeta');

      expect(turno.resumen.efectivoEsperadoCentavos).toBe(FONDO + 80_000);
    });

    it('resta los egresos en efectivo y los retiros', () => {
      const turno = abrir();
      cobrar(turno, 100_000, 'efectivo');
      turno.registrarMovimiento({
        tipo: 'egreso',
        concepto: 'Material dental',
        montoCentavos: 30_000,
        metodo: 'efectivo',
        registradoPor: 'user-1',
      });
      turno.registrarMovimiento({
        tipo: 'retiro',
        concepto: 'Depósito bancario',
        montoCentavos: 50_000,
        metodo: 'efectivo',
        registradoPor: 'user-1',
      });

      const { resumen } = turno;
      expect(resumen.egresosCentavos).toBe(30_000);
      expect(resumen.retirosCentavos).toBe(50_000);
      // El retiro sale del cajón pero NO es gasto: por eso van en renglones
      // distintos aunque los dos bajen el efectivo esperado.
      expect(resumen.ingresosCentavos).toBe(100_000);
      expect(resumen.efectivoEsperadoCentavos).toBe(FONDO + 100_000 - 30_000 - 50_000);
    });

    it('un egreso pagado con tarjeta no toca el efectivo del cajón', () => {
      const turno = abrir();
      turno.registrarMovimiento({
        tipo: 'egreso',
        concepto: 'Suscripción de software',
        montoCentavos: 40_000,
        metodo: 'tarjeta',
        registradoPor: 'user-1',
      });

      expect(turno.resumen.egresosCentavos).toBe(40_000);
      expect(turno.resumen.efectivoEsperadoCentavos).toBe(FONDO);
    });

    it('un retiro siempre es en efectivo, aunque se pida otro método', () => {
      const turno = abrir();
      const m = turno.registrarMovimiento({
        tipo: 'retiro',
        concepto: 'A bóveda',
        montoCentavos: 20_000,
        metodo: 'tarjeta',
        registradoPor: 'user-1',
      });

      expect(m.metodo).toBe('efectivo');
    });

    it('un movimiento cancelado deja de contar', () => {
      const turno = abrir();
      const m = cobrar(turno, 100_000);
      expect(turno.resumen.ingresosCentavos).toBe(100_000);

      turno.cancelarMovimiento(m.id, { motivo: 'Se capturó dos veces', canceladoPor: 'user-2' });

      expect(turno.resumen.ingresosCentavos).toBe(0);
      expect(turno.resumen.efectivoEsperadoCentavos).toBe(FONDO);
      // Pero sigue en el corte: cancelar no es borrar.
      expect(turno.movimientos).toHaveLength(1);
      expect(turno.movimientos[0]!.motivoCancelacion).toBe('Se capturó dos veces');
      expect(turno.movimientos[0]!.canceladoPor).toBe('user-2');
    });
  });

  describe('cierre', () => {
    it('calcula la diferencia contra lo contado', () => {
      const turno = abrir();
      cobrar(turno, 100_000);
      turno.cerrar({ cerradaPor: 'user-2', efectivoContadoCentavos: FONDO + 100_000 });

      expect(turno.abierta).toBe(false);
      expect(turno.resumen.diferenciaCentavos).toBe(0);
    });

    it('una diferencia negativa significa que falta dinero', () => {
      const turno = abrir();
      cobrar(turno, 100_000);
      // Contaron $50.00 menos de lo que debería haber.
      turno.cerrar({ cerradaPor: 'user-2', efectivoContadoCentavos: FONDO + 95_000 });

      expect(turno.resumen.diferenciaCentavos).toBe(-5_000);
    });

    it('un turno cerrado no admite movimientos, ni ediciones, ni un segundo cierre', () => {
      const turno = abrir();
      const m = cobrar(turno, 100_000);
      turno.cerrar({ cerradaPor: 'user-1', efectivoContadoCentavos: FONDO + 100_000 });

      expect(() => cobrar(turno, 10_000)).toThrow(TurnoCajaCerradoError);
      expect(() => turno.actualizarMovimiento(m.id, { concepto: 'Otro' })).toThrow(
        TurnoCajaCerradoError,
      );
      expect(() => turno.cancelarMovimiento(m.id, { motivo: 'x', canceladoPor: 'user-1' })).toThrow(
        TurnoCajaCerradoError,
      );
      expect(() =>
        turno.cerrar({ cerradaPor: 'user-1', efectivoContadoCentavos: 0 }),
      ).toThrow(TurnoCajaCerradoError);
    });
  });

  describe('corrección de movimientos', () => {
    it('corrige concepto y monto mientras el turno esté abierto', () => {
      const turno = abrir();
      const m = cobrar(turno, 100_000);

      turno.actualizarMovimiento(m.id, { concepto: 'Limpieza', montoCentavos: 90_000 });

      expect(turno.movimientos[0]!.concepto).toBe('Limpieza');
      expect(turno.resumen.efectivoEsperadoCentavos).toBe(FONDO + 90_000);
    });

    it('falla si el movimiento no existe', () => {
      const turno = abrir();
      expect(() => turno.actualizarMovimiento('no-existe', { concepto: 'x' })).toThrow(
        MovimientoCajaNoEncontradoError,
      );
    });

    it('no se edita ni se cancela dos veces un movimiento ya cancelado', () => {
      const turno = abrir();
      const m = cobrar(turno, 100_000);
      turno.cancelarMovimiento(m.id, { motivo: 'Duplicado', canceladoPor: 'user-1' });

      expect(() => turno.actualizarMovimiento(m.id, { concepto: 'x' })).toThrow(
        MovimientoCajaCanceladoError,
      );
      expect(() => turno.cancelarMovimiento(m.id, { motivo: 'y', canceladoPor: 'user-1' })).toThrow(
        MovimientoCajaCanceladoError,
      );
    });
  });

  describe('cobros ligados a un presupuesto', () => {
    /**
     * El abono en el presupuesto solo crece, nunca se reescribe: si aquí se
     * pudiera bajar el monto, el paciente quedaría con un saldo que no
     * corresponde a lo que pagó.
     */
    it('congela el monto y el método una vez que generó el abono', () => {
      const turno = abrir();
      const m = cobrar(turno, 100_000);
      turno.ligarAbono(m.id, 'abono-1');

      expect(() => turno.actualizarMovimiento(m.id, { montoCentavos: 50_000 })).toThrow(
        MovimientoLigadoAAbonoError,
      );
      expect(() => turno.actualizarMovimiento(m.id, { metodo: 'tarjeta' })).toThrow(
        MovimientoLigadoAAbonoError,
      );
      expect(() => turno.cancelarMovimiento(m.id, { motivo: 'x', canceladoPor: 'user-1' })).toThrow(
        MovimientoLigadoAAbonoError,
      );
    });

    it('sí permite corregir el concepto y la referencia, que no mueven dinero', () => {
      const turno = abrir();
      const m = cobrar(turno, 100_000);
      turno.ligarAbono(m.id, 'abono-1');

      turno.actualizarMovimiento(m.id, { concepto: 'Abono tratamiento', referencia: 'REC-42' });

      expect(turno.movimientos[0]!.concepto).toBe('Abono tratamiento');
      expect(turno.movimientos[0]!.referencia).toBe('REC-42');
    });
  });
});
