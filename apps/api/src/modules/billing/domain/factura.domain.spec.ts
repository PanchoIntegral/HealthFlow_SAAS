import { ConceptoCfdi, type TratamientoIva } from './concepto-cfdi.entity';
import { Factura } from './factura.entity';
import {
  FacturaSinConceptosError,
  TransicionFacturaInvalidaError,
} from './factura.errors';

const concepto = (
  valorUnitarioCentavos: number,
  tratamientoIva: TratamientoIva = 'EXENTO',
  cantidad = 1,
): ConceptoCfdi =>
  new ConceptoCfdi({
    claveProdServ: '85121600',
    claveUnidad: 'E48',
    descripcion: 'Consulta médica general',
    cantidad,
    valorUnitarioCentavos,
    tratamientoIva,
  });

const crearFactura = (conceptos: ConceptoCfdi[]): Factura =>
  Factura.crear({
    appointmentId: 'appt-1',
    emisorId: 'emisor-1',
    receptorId: 'receptor-1',
    conceptos,
  });

describe('Factura (entidad de dominio)', () => {
  describe('totales derivados de conceptos', () => {
    it('rechaza una factura sin conceptos', () => {
      expect(() => crearFactura([])).toThrow(FacturaSinConceptosError);
    });

    it('concepto EXENTO: iva 0, total = subtotal (consulta médica, art. 15 LIVA)', () => {
      const f = crearFactura([concepto(50000, 'EXENTO')]); // $500.00
      expect(f.subtotalCentavos).toBe(50000);
      expect(f.ivaCentavos).toBe(0);
      expect(f.totalCentavos).toBe(50000);
    });

    it('concepto TASA_16: iva = 16% redondeado al centavo', () => {
      const f = crearFactura([concepto(12345, 'TASA_16')]); // $123.45
      expect(f.subtotalCentavos).toBe(12345);
      expect(f.ivaCentavos).toBe(1975); // round(12345 * 0.16) = round(1975.2)
      expect(f.totalCentavos).toBe(14320);
    });

    it('concepto TASA_0: iva 0 pero distinto de exento en el CFDI', () => {
      const f = crearFactura([concepto(10000, 'TASA_0')]);
      expect(f.ivaCentavos).toBe(0);
      expect(f.totalCentavos).toBe(10000);
    });

    it('mezcla de tratamientos: el IVA se calcula por concepto', () => {
      const f = crearFactura([
        concepto(50000, 'EXENTO'), // consulta
        concepto(20000, 'TASA_16'), // insumo gravado
      ]);
      expect(f.subtotalCentavos).toBe(70000);
      expect(f.ivaCentavos).toBe(3200);
      expect(f.totalCentavos).toBe(73200);
    });

    it('cantidad fraccionaria redondea el importe al centavo', () => {
      const f = crearFactura([concepto(33333, 'EXENTO', 1.5)]);
      expect(f.subtotalCentavos).toBe(50000); // round(1.5 * 33333) = round(49999.5)
    });

    it('nace PENDIENTE, sin folio fiscal', () => {
      const f = crearFactura([concepto(10000)]);
      expect(f.estatus).toBe('PENDIENTE');
      expect(f.uuidFiscal).toBeNull();
    });
  });

  describe('máquina de estados', () => {
    it('PENDIENTE → TIMBRADA estampa folio fiscal y fecha', () => {
      const f = crearFactura([concepto(10000)]);
      const now = new Date('2026-07-16T12:00:00Z');
      f.marcarTimbrada('uuid-sat', 'pac-1', now);
      expect(f.estatus).toBe('TIMBRADA');
      expect(f.uuidFiscal).toBe('uuid-sat');
      expect(f.pacRawId).toBe('pac-1');
      expect(f.timbradaEn).toEqual(now);
    });

    it('TIMBRADA → CANCELADA con motivo obligatorio', () => {
      const f = crearFactura([concepto(10000)]);
      f.marcarTimbrada('uuid-sat', 'pac-1');
      f.cancelar('02');
      expect(f.estatus).toBe('CANCELADA');
      expect(f.motivoCancelacion).toBe('02');
      expect(f.canceladaEn).not.toBeNull();
    });

    it('PENDIENTE → ERROR → PENDIENTE (rama reintentable)', () => {
      const f = crearFactura([concepto(10000)]);
      f.marcarError('PAC_5XX');
      expect(f.estatus).toBe('ERROR');
      expect(f.errorCode).toBe('PAC_5XX');
      f.reintentar();
      expect(f.estatus).toBe('PENDIENTE');
      expect(f.errorCode).toBeNull();
    });

    it('no se puede cancelar una factura que nunca se timbró', () => {
      const f = crearFactura([concepto(10000)]);
      expect(() => f.cancelar('02')).toThrow(TransicionFacturaInvalidaError);
    });

    it('no se puede re-timbrar una TIMBRADA (inmutable ante el SAT)', () => {
      const f = crearFactura([concepto(10000)]);
      f.marcarTimbrada('uuid-sat', 'pac-1');
      expect(() => f.marcarTimbrada('otro', 'pac-2')).toThrow(TransicionFacturaInvalidaError);
      expect(() => f.marcarError('X')).toThrow(TransicionFacturaInvalidaError);
    });

    it('una CANCELADA es terminal', () => {
      const f = crearFactura([concepto(10000)]);
      f.marcarTimbrada('uuid-sat', 'pac-1');
      f.cancelar('02');
      expect(() => f.cancelar('03')).toThrow(TransicionFacturaInvalidaError);
      expect(() => f.marcarTimbrada('x', 'y')).toThrow(TransicionFacturaInvalidaError);
      expect(() => f.reintentar()).toThrow(TransicionFacturaInvalidaError);
    });

    it('reintentar solo aplica desde ERROR', () => {
      const f = crearFactura([concepto(10000)]);
      expect(() => f.reintentar()).toThrow(TransicionFacturaInvalidaError);
    });
  });
});
