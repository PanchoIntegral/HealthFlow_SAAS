import type { HorarioAtencion } from '@healthflow/shared-types';
import {
  ANTICIPACION_MINIMA_MS,
  diaSemanaLocal,
  generarHuecos,
  instanteLocal,
  seTraslapan,
} from './huecos';

const TZ = 'America/Mexico_City'; // UTC-6 todo el año desde 2022
const HORARIO: HorarioAtencion = { dias: [1, 2, 3, 4, 5], desde: '09:00', hasta: '18:00' };

/** Lunes 14 de septiembre de 2026, 09:00 en CDMX. */
const LUNES_9AM = new Date('2026-09-14T15:00:00Z');
/** Un día antes, para que los huecos del lunes ya cumplan la anticipación mínima. */
const AHORA = new Date('2026-09-13T15:00:00Z');

const horaLocal = (d: Date) =>
  new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

const base = (extra: Partial<Parameters<typeof generarHuecos>[0]> = {}) =>
  generarHuecos({
    desde: LUNES_9AM,
    dias: 1,
    duracionMinutos: 60,
    horario: HORARIO,
    tz: TZ,
    ocupados: [],
    ahora: AHORA,
    ...extra,
  });

describe('generarHuecos', () => {
  it('llena la jornada con huecos de la duración pedida', () => {
    const huecos = base();
    expect(huecos).toHaveLength(9); // 09:00 → 18:00, una hora cada uno
    expect(horaLocal(huecos[0]!.inicio)).toBe('09:00');
    expect(horaLocal(huecos[8]!.inicio)).toBe('17:00');
  });

  it('no ofrece un hueco que se pasaría de la hora de cierre', () => {
    // 9 horas de jornada en bloques de 2: caben cuatro y sobra media hora, que
    // se descarta en vez de ofrecer una cita que termina con la clínica cerrada.
    const huecos = base({ duracionMinutos: 120 });
    expect(huecos).toHaveLength(4);
    expect(horaLocal(huecos.at(-1)!.inicio)).toBe('15:00');
    expect(horaLocal(huecos.at(-1)!.fin)).toBe('17:00');
  });

  it('respeta duraciones que no dividen la jornada', () => {
    const huecos = base({ duracionMinutos: 45 });
    expect(horaLocal(huecos[0]!.inicio)).toBe('09:00');
    expect(huecos.at(-1)!.fin.getTime()).toBeLessThanOrEqual(
      instanteLocal(LUNES_9AM, '18:00', TZ).getTime(),
    );
  });

  describe('días de atención', () => {
    it('salta los días en que la clínica no abre', () => {
      // Sábado 19 y domingo 20: sin huecos con el horario L-V.
      const huecos = generarHuecos({
        desde: new Date('2026-09-19T15:00:00Z'),
        dias: 2,
        duracionMinutos: 60,
        horario: HORARIO,
        tz: TZ,
        ocupados: [],
        ahora: AHORA,
      });
      expect(huecos).toHaveLength(0);
    });

    it('abre en sábado si la clínica lo incluye', () => {
      const huecos = generarHuecos({
        desde: new Date('2026-09-19T15:00:00Z'),
        dias: 1,
        duracionMinutos: 60,
        horario: { ...HORARIO, dias: [6] },
        tz: TZ,
        ocupados: [],
        ahora: AHORA,
      });
      expect(huecos.length).toBeGreaterThan(0);
    });
  });

  describe('huecos ocupados', () => {
    it('descarta el que choca con una cita existente', () => {
      const ocupado = {
        inicio: instanteLocal(LUNES_9AM, '10:00', TZ),
        fin: instanteLocal(LUNES_9AM, '11:00', TZ),
      };
      const horas = base({ ocupados: [ocupado] }).map((h) => horaLocal(h.inicio));
      expect(horas).not.toContain('10:00');
      expect(horas).toContain('09:00');
      expect(horas).toContain('11:00');
    });

    it('descarta el que choca parcialmente', () => {
      const ocupado = {
        inicio: instanteLocal(LUNES_9AM, '10:30', TZ),
        fin: instanteLocal(LUNES_9AM, '11:30', TZ),
      };
      const horas = base({ ocupados: [ocupado] }).map((h) => horaLocal(h.inicio));
      expect(horas).not.toContain('10:00');
      expect(horas).not.toContain('11:00');
    });

    it('conserva el contiguo: terminar a las 10:00 no choca con empezar a las 10:00', () => {
      const ocupado = {
        inicio: instanteLocal(LUNES_9AM, '09:00', TZ),
        fin: instanteLocal(LUNES_9AM, '10:00', TZ),
      };
      const horas = base({ ocupados: [ocupado] }).map((h) => horaLocal(h.inicio));
      expect(horas).not.toContain('09:00');
      expect(horas).toContain('10:00');
    });
  });

  describe('anticipación mínima', () => {
    // Un hueco al que el paciente no puede llegar no le sirve a nadie.
    it('no ofrece nada dentro de las próximas dos horas', () => {
      const ahora = instanteLocal(LUNES_9AM, '09:00', TZ);
      const horas = base({ ahora }).map((h) => horaLocal(h.inicio));
      expect(horas).not.toContain('09:00');
      expect(horas).not.toContain('10:00');
      expect(horas).toContain('11:00');
    });

    it('el primer hueco siempre queda por encima del margen', () => {
      const ahora = instanteLocal(LUNES_9AM, '13:20', TZ);
      const primero = base({ ahora })[0];
      expect(primero!.inicio.getTime()).toBeGreaterThanOrEqual(
        ahora.getTime() + ANTICIPACION_MINIMA_MS,
      );
    });
  });

  describe('topes', () => {
    it('no devuelve más de los pedidos: la página se lee en un teléfono', () => {
      expect(base({ dias: 30, max: 5 })).toHaveLength(5);
    });

    it('nunca ofrece agenda más allá de 60 días', () => {
      const huecos = base({ dias: 400, max: 100_000 });
      const limite = AHORA.getTime() + 61 * 24 * 60 * 60 * 1000;
      expect(huecos.at(-1)!.inicio.getTime()).toBeLessThan(limite);
    });
  });

  it('devuelve los huecos en orden cronológico', () => {
    const huecos = base({ dias: 5, max: 100 });
    for (let i = 1; i < huecos.length; i++) {
      expect(huecos[i]!.inicio.getTime()).toBeGreaterThan(huecos[i - 1]!.inicio.getTime());
    }
  });
});

describe('seTraslapan', () => {
  const rango = (desde: string, hasta: string) => ({
    inicio: instanteLocal(LUNES_9AM, desde, TZ),
    fin: instanteLocal(LUNES_9AM, hasta, TZ),
  });

  it.each([
    ['idénticos', '10:00', '11:00', '10:00', '11:00', true],
    ['contenido', '10:00', '11:00', '10:15', '10:45', true],
    ['solapado por delante', '10:00', '11:00', '09:30', '10:30', true],
    ['solapado por detrás', '10:00', '11:00', '10:30', '11:30', true],
    ['contiguo por delante', '10:00', '11:00', '09:00', '10:00', false],
    ['contiguo por detrás', '10:00', '11:00', '11:00', '12:00', false],
    ['separados', '10:00', '11:00', '15:00', '16:00', false],
  ])('%s → %s', (_caso, aDesde, aHasta, bDesde, bHasta, esperado) => {
    const a = rango(aDesde, aHasta);
    expect(seTraslapan(a.inicio, a.fin, rango(bDesde, bHasta))).toBe(esperado);
  });
});

describe('diaSemanaLocal', () => {
  it.each([
    ['lunes', '2026-09-14T15:00:00Z', 1],
    ['viernes', '2026-09-18T15:00:00Z', 5],
    ['sábado', '2026-09-19T15:00:00Z', 6],
    ['domingo', '2026-09-20T15:00:00Z', 7],
  ])('%s → %s', (_caso, iso, esperado) => {
    expect(diaSemanaLocal(new Date(iso), TZ)).toBe(esperado);
  });

  // A las 03:00 UTC del martes todavía es lunes en CDMX: el día se cuenta con
  // el calendario de la clínica, no con el del servidor.
  it('usa el calendario local, no el del servidor', () => {
    expect(diaSemanaLocal(new Date('2026-09-15T03:00:00Z'), TZ)).toBe(1);
    expect(diaSemanaLocal(new Date('2026-09-15T03:00:00Z'), 'UTC')).toBe(2);
  });
});

describe('instanteLocal', () => {
  it('devuelve el instante en que el reloj local marca esa hora', () => {
    expect(horaLocal(instanteLocal(LUNES_9AM, '14:30', TZ))).toBe('14:30');
  });

  it('descarta segundos y milisegundos', () => {
    const t = instanteLocal(new Date('2026-09-14T15:07:33.412Z'), '09:00', TZ);
    expect(t.getUTCSeconds()).toBe(0);
    expect(t.getUTCMilliseconds()).toBe(0);
  });

  // El offset depende del instante: usar el de "hoy" falla el día del cambio.
  it('acierta cruzando un cambio de horario de verano', () => {
    const tj = 'America/Tijuana'; // sí observa horario de verano
    const dia = new Date('2026-11-01T12:00:00Z');
    expect(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tj,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(instanteLocal(dia, '09:00', tj)),
    ).toBe('09:00');
  });
});
