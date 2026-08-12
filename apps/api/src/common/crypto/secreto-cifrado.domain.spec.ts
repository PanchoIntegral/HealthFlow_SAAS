import {
  cargarKeyring,
  cifrarSecreto,
  descifrarSecreto,
  generarLlaveBase64,
  igualSeguro,
  SecretoCifradoError,
  type Keyring,
} from './secreto-cifrado';

const K1 = Buffer.alloc(32, 1).toString('base64');
const K2 = Buffer.alloc(32, 2).toString('base64');

const keyring = (activa = 'k1'): Keyring =>
  cargarKeyring(JSON.stringify({ k1: K1, k2: K2 }), activa);

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const TOKEN = 'EAAG...token-de-whatsapp-de-la-clinica';

describe('cargarKeyring', () => {
  it('rechaza un JSON malformado', () => {
    expect(() => cargarKeyring('{no json', 'k1')).toThrow(SecretoCifradoError);
  });

  it('rechaza llaves que no midan 32 bytes: AES-256 no admite otra cosa', () => {
    const corta = Buffer.alloc(16, 9).toString('base64');
    expect(() => cargarKeyring(JSON.stringify({ k1: corta }), 'k1')).toThrow(/32 bytes/);
  });

  it('rechaza ids de llave con caracteres que romperían el prefijo del ciphertext', () => {
    expect(() => cargarKeyring(JSON.stringify({ 'k.1': K1 }), 'k.1')).toThrow(/Id de llave/);
  });

  it('exige que la llave activa exista en el llavero', () => {
    expect(() => cargarKeyring(JSON.stringify({ k1: K1 }), 'k9')).toThrow(/activa/);
  });

  it('genera llaves del tamaño correcto', () => {
    expect(Buffer.from(generarLlaveBase64(), 'base64')).toHaveLength(32);
  });
});

describe('cifrarSecreto / descifrarSecreto', () => {
  it('devuelve el original con el mismo tenant', () => {
    const cifrado = cifrarSecreto(TOKEN, TENANT_A, keyring());
    expect(descifrarSecreto(cifrado, TENANT_A, keyring())).toBe(TOKEN);
  });

  it('nunca deja el secreto legible en la salida', () => {
    expect(cifrarSecreto(TOKEN, TENANT_A, keyring())).not.toContain('token-de-whatsapp');
  });

  it('cifra dos veces el mismo texto con resultados distintos (IV aleatorio)', () => {
    const a = cifrarSecreto(TOKEN, TENANT_A, keyring());
    const b = cifrarSecreto(TOKEN, TENANT_A, keyring());
    expect(a).not.toBe(b);
  });

  // La razón de ser del AAD: una fila copiada a otra clínica no sirve.
  it('falla si el AAD es el de otro tenant', () => {
    const cifrado = cifrarSecreto(TOKEN, TENANT_A, keyring());
    expect(() => descifrarSecreto(cifrado, TENANT_B, keyring())).toThrow(SecretoCifradoError);
  });

  it.each([
    ['el ciphertext', 4],
    ['el tag de autenticación', 3],
  ])('falla si %s fue manipulado', (_caso, indice) => {
    const partes = cifrarSecreto(TOKEN, TENANT_A, keyring()).split('.');
    const bytes = Buffer.from(partes[indice] ?? '', 'base64url');
    bytes.writeUInt8(bytes.readUInt8(0) ^ 0xff, 0);
    partes[indice] = bytes.toString('base64url');
    expect(() => descifrarSecreto(partes.join('.'), TENANT_A, keyring())).toThrow();
  });

  it.each([
    ['versión desconocida', 'v2.k1.AAAA.AAAA.AAAA'],
    ['formato incompleto', 'v1.k1.AAAA'],
    ['llave desconocida', 'v1.k9.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA'],
  ])('rechaza %s', (_caso, cifrado) => {
    expect(() => descifrarSecreto(cifrado, TENANT_A, keyring())).toThrow(SecretoCifradoError);
  });
});

describe('rotación de llaves', () => {
  // Lo cifrado con la llave vieja se sigue leyendo tras cambiar la activa:
  // rotar no exige migrar los datos ya guardados.
  it('descifra con la llave del prefijo, no con la activa', () => {
    const conK1 = cifrarSecreto(TOKEN, TENANT_A, keyring('k1'));
    expect(descifrarSecreto(conK1, TENANT_A, keyring('k2'))).toBe(TOKEN);
  });

  it('cifra siempre con la activa', () => {
    expect(cifrarSecreto(TOKEN, TENANT_A, keyring('k2')).split('.')[1]).toBe('k2');
  });
});

describe('igualSeguro', () => {
  it.each([
    ['iguales', 'abc', 'abc', true],
    ['distintos de la misma longitud', 'abc', 'abd', false],
    ['distinta longitud', 'abc', 'abcd', false],
    ['vacíos', '', '', true],
  ])('%s', (_caso, a, b, esperado) => {
    expect(igualSeguro(a, b)).toBe(esperado);
  });
});
