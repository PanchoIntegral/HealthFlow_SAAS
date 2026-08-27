import { firmar, firmaValida, rutaAbsoluta } from './local-disk.adapter';

const futuro = () => Math.floor(Date.now() / 1000) + 60;

describe('firmas del storage local', () => {
  it('acepta una firma vigente emitida por nosotros', () => {
    const exp = futuro();
    expect(firmaValida('get', 'k.png', exp, firmar('get', 'k.png', exp))).toBe(true);
  });

  it('rechaza una firma vencida', () => {
    const exp = Math.floor(Date.now() / 1000) - 1;
    expect(firmaValida('get', 'k.png', exp, firmar('get', 'k.png', exp))).toBe(false);
  });

  it('no deja usar una firma de subida para leer (ni al revés)', () => {
    const exp = futuro();
    expect(firmaValida('get', 'k.png', exp, firmar('upload', 'k.png', exp))).toBe(false);
  });

  it('rechaza una firma de OTRA clave', () => {
    const exp = futuro();
    expect(firmaValida('get', 'otra.png', exp, firmar('get', 'k.png', exp))).toBe(false);
  });
});

describe('rutaAbsoluta', () => {
  it('mantiene el archivo dentro del directorio de storage', () => {
    expect(rutaAbsoluta('tenant/t1/patients/p1/a.png')).toMatch(
      /\/tenant\/t1\/patients\/p1\/a\.png$/,
    );
  });

  it('no permite escapar del directorio con ..', () => {
    expect(() => rutaAbsoluta('../../../etc/passwd')).toThrow();
    expect(() => rutaAbsoluta('/etc/passwd')).toThrow();
  });
});
