import { esE164, normalizarE164Mx } from './telefono-e164';

describe('normalizarE164Mx', () => {
  describe('números mexicanos que sí se pueden enviar', () => {
    it.each([
      ['10 dígitos pelones', '5551234567'],
      ['con guiones', '555-123-4567'],
      ['con lada entre paréntesis', '(555) 123 45 67'],
      ['con lada de país sin +', '525551234567'],
      ['con + explícito', '+525551234567'],
      ['formato viejo con 1 intermedio', '5215551234567'],
      ['prefijo derogado 044', '0445551234567'],
      ['prefijo derogado 045', '0455551234567'],
      ['con espacios y puntos', ' 55.51 23 45 67 '],
    ])('%s → +525551234567', (_caso, crudo) => {
      expect(normalizarE164Mx(crudo)).toBe('+525551234567');
    });

    it('conserva la lada regional, no solo la del DF', () => {
      expect(normalizarE164Mx('(664) 123 45 67')).toBe('+526641234567');
    });
  });

  describe('números internacionales', () => {
    // Hay pacientes extranjeros: forzarles +52 los volvería inválidos.
    it.each([
      ['España', '+34612345678', '+34612345678'],
      ['Estados Unidos', '+1 415 555 0123', '+14155550123'],
    ])('respeta el de %s', (_caso, crudo, esperado) => {
      expect(normalizarE164Mx(crudo)).toBe(esperado);
    });
  });

  describe('basura que hay en la columna de texto libre — todo debe dar null', () => {
    it.each([
      ['el caso real del expediente', '555-123'],
      ['vacío', ''],
      ['solo espacios', '   '],
      ['null', null],
      ['undefined', undefined],
      ['sin dígitos', 'no tiene'],
      ['extensión de conmutador', '55512'],
      ['demasiados dígitos sin +', '5255512345678901'],
      ['9 dígitos', '555123456'],
      ['11 dígitos sin lada reconocible', '55512345678'],
      ['+ con lada inválida', '+0123456789'],
    ])('%s', (_caso, crudo) => {
      expect(normalizarE164Mx(crudo)).toBeNull();
    });
  });

  it('es idempotente: normalizar lo ya normalizado no lo cambia', () => {
    const una = normalizarE164Mx('555 123 4567');
    expect(normalizarE164Mx(una)).toBe(una);
  });
});

describe('esE164', () => {
  it.each([
    ['+525551234567', true],
    ['+34612345678', true],
    ['5551234567', false],
    ['+0123456789', false],
    ['+52555', false],
  ])('%s → %s', (valor, esperado) => {
    expect(esE164(valor)).toBe(esperado);
  });
});
