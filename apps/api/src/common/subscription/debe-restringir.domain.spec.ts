import { avisoSuscripcion, debeRestringir, diasDeGracia, DIAS_DE_GRACIA } from './debe-restringir';
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

/**
 * Lo que ve el usuario ANTES de que le corten. El caso que da sentido a todo
 * esto es el primero: 'past_due' dentro de la gracia no restringe nada, así que
 * sin este aviso el usuario pasaría los 7 días sin enterarse.
 */
describe('avisoSuscripcion', () => {
  it('past_due dentro de la gracia advierte, sin suspender', () => {
    expect(avisoSuscripcion(estado('past_due', MANANA), AHORA)).toBe('advertencia');
    // Y sigue pudiendo escribir: la advertencia no restringe.
    expect(debeRestringir(estado('past_due', MANANA), AHORA)).toBe(false);
  });

  it('past_due con la gracia agotada ya es suspensión', () => {
    expect(avisoSuscripcion(estado('past_due', AYER), AHORA)).toBe('suspendida');
  });

  it('past_due sin fecha de gracia advierte (el fail-open no debe ser silencioso)', () => {
    // Se perdió el webhook: no se restringe, pero sí se avisa. Callar dejaría
    // al usuario sin saber que su tarjeta falló.
    expect(avisoSuscripcion(estado('past_due', null), AHORA)).toBe('advertencia');
  });

  it.each(['active', 'trialing', 'none'] as const)('%s no muestra nada', (status) => {
    expect(avisoSuscripcion(estado(status), AHORA)).toBe('ok');
  });

  it.each(['canceled', 'incomplete_expired', 'paused'] as const)(
    '%s va directo a suspendida, sin advertencia previa',
    (status) => {
      // Ya no hay plazo que ofrecer: llegar aquí agotó los reintentos.
      expect(avisoSuscripcion(estado(status), AHORA)).toBe('suspendida');
    },
  );

  it("'unpaid' suspende aunque también 'requiera atención'", () => {
    // Cae en los dos predicados; manda el más grave.
    expect(avisoSuscripcion(estado('unpaid'), AHORA)).toBe('suspendida');
  });

  it("'incomplete' advierte: hay un cobro pendiente, pero no se restringe", () => {
    expect(avisoSuscripcion(estado('incomplete'), AHORA)).toBe('advertencia');
  });

  it('cubre todos los status declarados', () => {
    for (const status of SUBSCRIPTION_STATUSES) {
      expect(['ok', 'advertencia', 'suspendida']).toContain(
        avisoSuscripcion(estado(status, AYER), AHORA),
      );
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
