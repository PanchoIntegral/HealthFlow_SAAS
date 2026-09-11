import {
  EnlaceNoValidoError,
  esFormatoDeTokenPublico,
  evaluarToken,
  generarTokenPublico,
  hashTokenPublico,
  hashesIguales,
  type EstadoTokenPublico,
} from './token-publico';

const AHORA = new Date('2026-09-11T12:00:00Z');

function estado(over: Partial<EstadoTokenPublico> = {}): EstadoTokenPublico {
  return {
    proposito: 'plan_tratamiento',
    expiresAt: new Date('2026-09-30T00:00:00Z'),
    revokedAt: null,
    usos: 0,
    maxUsos: null,
    ...over,
  };
}

describe('Tokens de enlaces públicos', () => {
  it('genera 256 bits y nunca repite', () => {
    const tokens = new Set(Array.from({ length: 200 }, generarTokenPublico));
    expect(tokens.size).toBe(200);
    const uno = generarTokenPublico();
    // 32 bytes en base64url son 43 caracteres sin relleno.
    expect(uno).toHaveLength(43);
    expect(Buffer.from(uno, 'base64url')).toHaveLength(32);
    expect(esFormatoDeTokenPublico(uno)).toBe(true);
  });

  it('el hash es estable, de 64 hex, y no permite volver al token', () => {
    const token = generarTokenPublico();
    const hash = hashTokenPublico(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashTokenPublico(token)).toBe(hash);
    expect(hash).not.toContain(token);
  });

  it('rechaza formatos que no vale la pena consultar en la base', () => {
    expect(esFormatoDeTokenPublico('')).toBe(false);
    expect(esFormatoDeTokenPublico('corto')).toBe(false);
    expect(esFormatoDeTokenPublico('a'.repeat(61))).toBe(false);
    expect(esFormatoDeTokenPublico(`${'a'.repeat(42)}/`)).toBe(false); // '/' no es base64url
    expect(esFormatoDeTokenPublico("' OR 1=1--")).toBe(false);
  });

  it('compara hashes en tiempo constante sin romperse con longitudes distintas', () => {
    const a = hashTokenPublico('x');
    expect(hashesIguales(a, a)).toBe(true);
    expect(hashesIguales(a, hashTokenPublico('y'))).toBe(false);
    expect(hashesIguales(a, 'corto')).toBe(false);
  });

  describe('vigencia', () => {
    it('acepta un token vigente del propósito correcto', () => {
      expect(evaluarToken(estado(), 'plan_tratamiento', AHORA)).toEqual({ ok: true });
    });

    it('un token de formulario no sirve para aceptar un plan', () => {
      expect(evaluarToken(estado({ proposito: 'formulario' }), 'plan_tratamiento', AHORA)).toEqual({
        ok: false,
        motivo: 'proposito',
      });
    });

    it('rechaza vencido, revocado y agotado', () => {
      expect(
        evaluarToken(estado({ expiresAt: new Date('2026-09-01T00:00:00Z') }), 'plan_tratamiento', AHORA),
      ).toEqual({ ok: false, motivo: 'vencido' });
      expect(
        evaluarToken(estado({ revokedAt: new Date('2026-09-10T00:00:00Z') }), 'plan_tratamiento', AHORA),
      ).toEqual({ ok: false, motivo: 'revocado' });
      expect(
        evaluarToken(estado({ usos: 1, maxUsos: 1 }), 'plan_tratamiento', AHORA),
      ).toEqual({ ok: false, motivo: 'agotado' });
    });

    it('sin límite de usos, un enlace de consulta se puede abrir muchas veces', () => {
      expect(evaluarToken(estado({ usos: 37, maxUsos: null }), 'plan_tratamiento', AHORA).ok).toBe(true);
    });

    it('vence justo al cumplirse la hora, no un instante después', () => {
      expect(evaluarToken(estado({ expiresAt: AHORA }), 'plan_tratamiento', AHORA)).toEqual({
        ok: false,
        motivo: 'vencido',
      });
    });
  });

  it('el error hacia afuera es idéntico para toda causa (no permite enumerar)', () => {
    const respuestas = (['inexistente', 'vencido', 'revocado', 'agotado'] as const).map((m) => {
      const e = new EnlaceNoValidoError(m);
      return JSON.stringify({
        code: e.code,
        status: e.httpStatus,
        message: e.message,
        details: e.details(),
      });
    });
    expect(new Set(respuestas).size).toBe(1);
  });
});
