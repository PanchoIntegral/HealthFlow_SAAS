import { Rfc } from './rfc.value-object';
import { RfcInvalidoError } from './factura.errors';

describe('Rfc (value object)', () => {
  it('acepta RFC de persona física (13 posiciones)', () => {
    const rfc = Rfc.create('GODE561231GR8');
    expect(rfc.value).toBe('GODE561231GR8');
    expect(rfc.esPersonaFisica).toBe(true);
  });

  it('acepta RFC de persona moral (12 posiciones)', () => {
    const rfc = Rfc.create('EKU9003173C9');
    expect(rfc.value).toBe('EKU9003173C9');
    expect(rfc.esPersonaFisica).toBe(false);
  });

  it('acepta los RFC genéricos del SAT', () => {
    expect(Rfc.create('XAXX010101000').value).toBe('XAXX010101000'); // público en general
    expect(Rfc.create('XEXX010101000').value).toBe('XEXX010101000'); // extranjeros
  });

  it('normaliza: trim y mayúsculas', () => {
    expect(Rfc.create('  gode561231gr8 ').value).toBe('GODE561231GR8');
  });

  it('acepta Ñ y & en la parte alfabética', () => {
    expect(Rfc.create('Ñ&Ñ990101AB1').value).toBe('Ñ&Ñ990101AB1');
  });

  it.each([
    ['', 'vacío'],
    ['GODE561231', 'sin homoclave'],
    ['GODE561331GR8', 'mes 13 inválido'],
    ['GODE561200GR8', 'día 00 inválido'],
    ['GODE561231GR89', 'demasiado largo'],
    ['1ODE561231GR8', 'inicia con dígito'],
    ['GODE56123!GR8', 'caracter inválido'],
  ])('rechaza "%s" (%s)', (raw) => {
    expect(() => Rfc.create(raw)).toThrow(RfcInvalidoError);
  });
});
