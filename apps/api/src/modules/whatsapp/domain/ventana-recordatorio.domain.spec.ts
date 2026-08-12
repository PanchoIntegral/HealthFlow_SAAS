import {
  agotoIntentos,
  calcularProgramadoPara,
  enSilencio,
  evitarSilencio,
  fijarHoraLocal,
  horaLocal,
  MAX_INTENTOS,
  minutosParaSiguienteIntento,
  type VentanaSilencio,
} from './ventana-recordatorio';

// CDMX es UTC-6 todo el año desde que México eliminó el horario de verano (2022).
const CDMX: VentanaSilencio = { desdeHora: 21, hastaHora: 8, tz: 'America/Mexico_City' };
// Tijuana sí observa horario de verano: sirve para los casos de cambio de offset.
const TIJUANA: VentanaSilencio = { desdeHora: 21, hastaHora: 8, tz: 'America/Tijuana' };

const HORA = 60 * 60 * 1000;
/** Instante en que corre el barrido en todos los casos, salvo que se diga otra cosa. */
const AHORA = new Date('2026-08-10T15:00:00Z'); // 09:00 en CDMX

describe('calcularProgramadoPara', () => {
  it('resta las horas de anticipación configuradas', () => {
    // Cita el 12 ago 16:00Z (10:00 CDMX). Con 24h de anticipación: 11 ago 16:00Z.
    const cita = new Date('2026-08-12T16:00:00Z');
    expect(calcularProgramadoPara(cita, 24, AHORA, CDMX)).toEqual(
      new Date('2026-08-11T16:00:00Z'),
    );
  });

  it('respeta una anticipación distinta de 24h', () => {
    const cita = new Date('2026-08-12T16:00:00Z');
    expect(calcularProgramadoPara(cita, 48, AHORA, CDMX)).toEqual(
      new Date('2026-08-10T16:00:00Z'),
    );
  });

  // Una cita a 20h con anticipación de 24h ya "debió" avisarse: sale en el
  // próximo barrido, no se descarta.
  it('devuelve un momento en el pasado si la ventana ya se pasó', () => {
    const cita = new Date(AHORA.getTime() + 20 * HORA);
    const programado = calcularProgramadoPara(cita, 24, AHORA, CDMX);
    expect(programado).not.toBeNull();
    expect(programado!.getTime()).toBeLessThan(AHORA.getTime());
  });

  describe('citas demasiado próximas', () => {
    it.each([
      ['a 3 horas', 3, true],
      ['a 2 horas exactas', 2, true],
      ['a 1 hora', 1, false],
      ['a 30 minutos', 0.5, false],
    ])('cita %s → se programa: %s', (_caso, horas, seProgramaba) => {
      const cita = new Date(AHORA.getTime() + horas * HORA);
      const resultado = calcularProgramadoPara(cita, 24, AHORA, CDMX);
      expect(resultado !== null).toBe(seProgramaba);
    });

    it('descarta una cita que ya pasó', () => {
      const cita = new Date(AHORA.getTime() - HORA);
      expect(calcularProgramadoPara(cita, 24, AHORA, CDMX)).toBeNull();
    });
  });

  describe('ventana de silencio', () => {
    it('empuja a las 08:00 locales un envío que caería de madrugada', () => {
      // Cita el 13 ago 08:00 CDMX (14:00Z). Menos 24h → 12 ago 08:00 CDMX...
      // usemos una cita a las 05:00 CDMX para que el aviso caiga a las 05:00.
      const cita = new Date('2026-08-13T11:00:00Z'); // 05:00 CDMX
      const programado = calcularProgramadoPara(cita, 24, AHORA, CDMX)!;
      expect(horaLocal(programado, CDMX.tz)).toBe(8);
      // Mismo día local que el ideal (12 ago), no el anterior.
      expect(programado).toEqual(new Date('2026-08-12T14:00:00Z'));
    });

    it('empuja un envío que caería a las 23:40', () => {
      const cita = new Date('2026-08-13T05:40:00Z'); // 23:40 del 12 en CDMX
      const programado = calcularProgramadoPara(cita, 24, AHORA, CDMX)!;
      expect(horaLocal(programado, CDMX.tz)).toBe(8);
      // 23:40 del 11 cae en silencio → se va a las 08:00 del 12.
      expect(programado).toEqual(new Date('2026-08-12T14:00:00Z'));
    });

    it('no toca un envío que cae en horario hábil', () => {
      const cita = new Date('2026-08-12T16:00:00Z'); // 10:00 CDMX
      const programado = calcularProgramadoPara(cita, 24, AHORA, CDMX)!;
      expect(programado).toEqual(new Date('2026-08-11T16:00:00Z'));
      expect(horaLocal(programado, CDMX.tz)).toBe(10);
    });

    // La regla que evita el peor error posible: avisar antes de tiempo.
    it('nunca adelanta el envío', () => {
      for (let h = 0; h < 24; h++) {
        const cita = new Date(Date.UTC(2026, 8, 20, h, 0, 0));
        const ideal = new Date(cita.getTime() - 24 * HORA);
        const programado = calcularProgramadoPara(cita, 24, AHORA, CDMX);
        expect(programado!.getTime()).toBeGreaterThanOrEqual(ideal.getTime());
      }
    });

    it('nunca programa el aviso después de la propia cita', () => {
      for (let h = 0; h < 24; h++) {
        const cita = new Date(Date.UTC(2026, 8, 20, h, 0, 0));
        const programado = calcularProgramadoPara(cita, 3, AHORA, CDMX);
        expect(programado!.getTime()).toBeLessThan(cita.getTime());
      }
    });

    it('respeta la zona de la clínica, no la del servidor', () => {
      // 09:00Z = 03:00 en CDMX (silencio) pero 02:00 en Tijuana (también).
      // A las 14:00Z: 08:00 CDMX (hábil) y 07:00 Tijuana (silencio).
      const cita = new Date('2026-08-13T14:00:00Z');
      expect(horaLocal(calcularProgramadoPara(cita, 24, AHORA, CDMX)!, CDMX.tz)).toBe(8);
      expect(horaLocal(calcularProgramadoPara(cita, 24, AHORA, TIJUANA)!, TIJUANA.tz)).toBe(8);
    });

    it('deja pasar todo si la clínica desactivó el silencio', () => {
      const sinSilencio: VentanaSilencio = { desdeHora: 0, hastaHora: 0, tz: CDMX.tz };
      const cita = new Date('2026-08-13T11:00:00Z');
      expect(calcularProgramadoPara(cita, 24, AHORA, sinSilencio)).toEqual(
        new Date('2026-08-12T11:00:00Z'),
      );
    });
  });
});

describe('enSilencio', () => {
  describe('franja que cruza la medianoche (21→8), el caso normal', () => {
    it.each([
      [21, true],
      [23, true],
      [0, true],
      [7, true],
      [8, false],
      [12, false],
      [20, false],
    ])('las %s h → %s', (hora, esperado) => {
      expect(enSilencio(hora, 21, 8)).toBe(esperado);
    });
  });

  describe('franja que no cruza la medianoche (1→6)', () => {
    it.each([
      [0, false],
      [1, true],
      [5, true],
      [6, false],
      [23, false],
    ])('las %s h → %s', (hora, esperado) => {
      expect(enSilencio(hora, 1, 6)).toBe(esperado);
    });
  });
});

describe('fijarHoraLocal', () => {
  it('avanza a la hora objetivo del mismo día si aún no ha pasado', () => {
    const t = fijarHoraLocal(new Date('2026-08-12T09:00:00Z'), 8, CDMX.tz); // 03:00 CDMX
    expect(t).toEqual(new Date('2026-08-12T14:00:00Z')); // 08:00 CDMX
  });

  it('salta al día siguiente si la hora objetivo ya pasó', () => {
    const t = fijarHoraLocal(new Date('2026-08-12T05:40:00Z'), 8, CDMX.tz); // 23:40 del 11
    expect(t).toEqual(new Date('2026-08-12T14:00:00Z')); // 08:00 del 12
  });

  it('descarta segundos y milisegundos', () => {
    const t = fijarHoraLocal(new Date('2026-08-12T09:13:47.913Z'), 8, CDMX.tz);
    expect(t.getUTCSeconds()).toBe(0);
    expect(t.getUTCMilliseconds()).toBe(0);
  });

  // El offset depende del instante: usar el de "hoy" falla el día del cambio.
  it('acierta la hora local incluso cruzando un cambio de horario de verano', () => {
    // Tijuana vuelve a horario estándar el 1 de noviembre de 2026 a las 02:00.
    const antes = new Date('2026-11-01T04:30:00Z'); // 21:30 del 31 oct en Tijuana
    expect(horaLocal(fijarHoraLocal(antes, 8, TIJUANA.tz), TIJUANA.tz)).toBe(8);
  });

  it('siempre devuelve un instante posterior o igual al de entrada', () => {
    for (let h = 0; h < 24; h++) {
      const desde = new Date(Date.UTC(2026, 10, 1, h, 30, 0));
      expect(fijarHoraLocal(desde, 8, TIJUANA.tz).getTime()).toBeGreaterThanOrEqual(
        desde.getTime() - 60_000,
      );
    }
  });
});

describe('reintentos', () => {
  it.each([
    [0, 2],
    [1, 2],
    [2, 4],
    [3, 8],
    [4, 16],
    [5, 32],
    [6, 60],
    [10, 60],
  ])('tras %s intentos espera %s minutos', (intentos, esperado) => {
    expect(minutosParaSiguienteIntento(intentos)).toBe(esperado);
  });

  it('se rinde al llegar al tope', () => {
    expect(agotoIntentos(MAX_INTENTOS - 1)).toBe(false);
    expect(agotoIntentos(MAX_INTENTOS)).toBe(true);
    expect(agotoIntentos(MAX_INTENTOS + 1)).toBe(true);
  });
});
