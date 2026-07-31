import { decayMsFor, retryAfterSeconds } from './login-policy';

const NOW = new Date('2026-01-15T12:00:00.000Z');
const secondsAgo = (s: number) => new Date(NOW.getTime() - s * 1000);

describe('login-policy', () => {
  describe('ámbito email', () => {
    it('no bloquea mientras los fallos estén por debajo del primer escalón', () => {
      expect(retryAfterSeconds('email', 4, secondsAgo(1), NOW)).toBe(0);
    });

    it('bloquea 1 minuto a partir del quinto fallo', () => {
      expect(retryAfterSeconds('email', 5, secondsAgo(0), NOW)).toBe(60);
    });

    it('descuenta el tiempo ya transcurrido desde el último intento', () => {
      expect(retryAfterSeconds('email', 5, secondsAgo(20), NOW)).toBe(40);
    });

    it('deja de bloquear cuando el castigo del escalón ya se cumplió', () => {
      expect(retryAfterSeconds('email', 5, secondsAgo(61), NOW)).toBe(0);
    });

    it('escala al siguiente castigo conforme se acumulan fallos', () => {
      expect(retryAfterSeconds('email', 10, secondsAgo(0), NOW)).toBe(5 * 60);
      expect(retryAfterSeconds('email', 15, secondsAgo(0), NOW)).toBe(15 * 60);
    });

    it('mantiene el último escalón como tope, sin crecer indefinidamente', () => {
      expect(retryAfterSeconds('email', 10_000, secondsAgo(0), NOW)).toBe(15 * 60);
    });

    it('olvida el historial tras el periodo de decaimiento', () => {
      const stale = new Date(NOW.getTime() - decayMsFor('email'));
      expect(retryAfterSeconds('email', 500, stale, NOW)).toBe(0);
    });
  });

  describe('ámbito ip', () => {
    it('tolera más fallos que el ámbito email antes de bloquear', () => {
      // Una IP puede ser el NAT de un consultorio entero: varios usuarios
      // legítimos comparten origen y no deben castigarse entre sí a la primera.
      expect(retryAfterSeconds('ip', 9, secondsAgo(0), NOW)).toBe(0);
      expect(retryAfterSeconds('ip', 10, secondsAgo(0), NOW)).toBe(60);
    });

    it('castiga mucho más duro que el ámbito email en el extremo', () => {
      expect(retryAfterSeconds('ip', 100, secondsAgo(0), NOW)).toBe(2 * 60 * 60);
      expect(retryAfterSeconds('ip', 100, secondsAgo(0), NOW)).toBeGreaterThan(
        retryAfterSeconds('email', 100, secondsAgo(0), NOW),
      );
    });
  });
});
