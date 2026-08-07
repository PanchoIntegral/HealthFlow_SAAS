import { debeRestringir, diasDeGracia, DIAS_DE_GRACIA } from './debe-restringir';
import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from './subscription-status';

const AHORA = new Date('2026-08-07T12:00:00Z');
const AYER = new Date('2026-08-06T12:00:00Z');
const MANANA = new Date('2026-08-08T12:00:00Z');

const estado = (status: SubscriptionStatus, graceUntil: Date | null = null) => ({
  status,
  graceUntil,
});

/**
 * La regla de negocio de la suspensión por impago, sin base de datos. Que la
 * API la cobre de verdad se prueba en test/suscripcion-gating.integration.spec.ts.
 */
describe('debeRestringir', () => {
  describe('cuentas al corriente', () => {
    it.each(['active', 'trialing'] as const)('%s no restringe', (status) => {
      expect(debeRestringir(estado(status), AHORA)).toBe(false);
    });

    it("'incomplete' no restringe: es el primer cobro en confirmarse", () => {
      // Dura minutos. Cortar el acceso ahí castigaría a quien acaba de pagar.
      expect(debeRestringir(estado('incomplete'), AHORA)).toBe(false);
    });

    it("'none' no restringe: nunca pasó por Stripe", () => {
      // Seeds, desarrollo y cuentas anteriores al self-serve. No hay nada
      // que cobrar, así que no hay nada que suspender.
      expect(debeRestringir(estado('none'), AHORA)).toBe(false);
    });
  });

  describe("'past_due': corre el reloj de la gracia", () => {
    it('dentro de la gracia todavía no restringe', () => {
      expect(debeRestringir(estado('past_due', MANANA), AHORA)).toBe(false);
    });

    it('vencida la gracia, restringe', () => {
      expect(debeRestringir(estado('past_due', AYER), AHORA)).toBe(true);
    });

    it('justo en el instante del vencimiento todavía no restringe', () => {
      // El corte es estrictamente "ya pasó", no "llegó". Un empate a favor
      // del cliente cuesta segundos; al revés cuesta una queja.
      expect(debeRestringir(estado('past_due', AHORA), AHORA)).toBe(false);
    });

    it('sin fecha de gracia NO restringe (fail-open deliberado)', () => {
      // Significa que se perdió el webhook de invoice.payment_failed y no
      // sabemos desde cuándo debe. Ante la duda no se le corta el acceso a
      // una clínica que quizá sí pagó: el job de reconciliación lo rellena.
      expect(debeRestringir(estado('past_due', null), AHORA)).toBe(false);
    });
  });

  describe('cuentas sin nada que esperar', () => {
    it.each(['unpaid', 'canceled', 'incomplete_expired', 'paused'] as const)(
      '%s restringe, incluso sin fecha de gracia',
      (status) => {
        expect(debeRestringir(estado(status), AHORA)).toBe(true);
        // Una gracia en el futuro tampoco los salva: la gracia solo aplica a
        // 'past_due'. Llegar a estos estados ya agotó los reintentos.
        expect(debeRestringir(estado(status, MANANA), AHORA)).toBe(true);
      },
    );
  });

  it('cubre todos los status declarados: ninguno queda sin decidir', () => {
    // Si Stripe agrega un estado y se suma a SUBSCRIPTION_STATUSES sin
    // manejarlo, el switch devolvería undefined y una escritura pasaría (o se
    // bloquearía) por accidente. Este test lo caza.
    for (const status of SUBSCRIPTION_STATUSES) {
      expect(typeof debeRestringir(estado(status, AYER), AHORA)).toBe('boolean');
    }
  });
});

describe('diasDeGracia', () => {
  it('quien ya había pagado recibe los 7 días', () => {
    expect(diasDeGracia(AYER)).toBe(DIAS_DE_GRACIA);
  });

  it('quien nunca pagó no recibe gracia', () => {
    // El trial de 14 días más 7 de gracia serían 21 días gratis para alguien
    // que jamás puso una tarjeta válida.
    expect(diasDeGracia(null)).toBe(0);
  });
});
