import { diasEntre, esFechaLocal, fechaLocal, noEsPosterior, sumarDias, sumarMeses } from './fecha-local';

describe('Fechas locales de la clínica', () => {
  describe('fechaLocal', () => {
    it('usa la zona de la clínica, no la del servidor', () => {
      // 06:00 UTC del 12 de marzo es todavía el 11 en Tijuana (UTC-8/-7).
      const instante = new Date('2026-03-12T06:00:00Z');
      expect(fechaLocal(instante, 'America/Mexico_City')).toBe('2026-03-12');
      expect(fechaLocal(instante, 'America/Tijuana')).toBe('2026-03-11');
    });

    it('devuelve siempre YYYY-MM-DD, que es lo que acepta `date`', () => {
      expect(fechaLocal(new Date('2026-01-05T18:00:00Z'), 'America/Mexico_City')).toMatch(
        /^\d{4}-\d{2}-\d{2}$/,
      );
    });
  });

  describe('sumarMeses', () => {
    it('el caso normal', () => {
      expect(sumarMeses('2026-03-15', 6)).toBe('2026-09-15');
      expect(sumarMeses('2026-09-15', 1)).toBe('2026-10-15');
    });

    it('recorta al último día cuando el día no existe en el mes destino', () => {
      // Una limpieza del 31 de agosto con control semestral vence el 28 de
      // febrero, no el 2 o 3 de marzo.
      expect(sumarMeses('2025-08-31', 6)).toBe('2026-02-28');
      expect(sumarMeses('2026-01-31', 1)).toBe('2026-02-28');
      expect(sumarMeses('2026-05-31', 1)).toBe('2026-06-30');
    });

    it('respeta los años bisiestos', () => {
      expect(sumarMeses('2027-08-31', 6)).toBe('2028-02-29');
      expect(sumarMeses('2028-02-29', 12)).toBe('2029-02-28');
    });

    it('cruza el fin de año', () => {
      expect(sumarMeses('2026-11-20', 3)).toBe('2027-02-20');
      expect(sumarMeses('2026-12-31', 12)).toBe('2027-12-31');
      expect(sumarMeses('2026-01-15', 24)).toBe('2028-01-15');
    });

    it('no se deja llevar por el horario de verano', () => {
      // Con aritmética de milisegundos, un cambio de horario mueve la fecha.
      expect(sumarMeses('2026-03-01', 1)).toBe('2026-04-01');
      expect(sumarMeses('2026-10-01', 1)).toBe('2026-11-01');
    });
  });

  describe('sumarDias', () => {
    it('suma y resta, cruzando meses y años', () => {
      expect(sumarDias('2026-09-11', 7)).toBe('2026-09-18');
      expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
      expect(sumarDias('2026-01-01', -1)).toBe('2025-12-31');
      expect(sumarDias('2028-02-28', 1)).toBe('2028-02-29');
    });
  });

  it('compara y resta fechas', () => {
    expect(noEsPosterior('2026-09-11', '2026-09-11')).toBe(true);
    expect(noEsPosterior('2026-09-10', '2026-09-11')).toBe(true);
    expect(noEsPosterior('2026-09-12', '2026-09-11')).toBe(false);
    expect(diasEntre('2026-09-11', '2026-09-18')).toBe(7);
    expect(diasEntre('2026-09-18', '2026-09-11')).toBe(-7);
    // Entre dos fechas que cruzan un cambio de horario siguen siendo días
    // completos, no 29 días y 23 horas redondeados hacia abajo.
    expect(diasEntre('2026-03-01', '2026-04-01')).toBe(31);
  });

  it('valida el formato y el calendario', () => {
    expect(esFechaLocal('2026-09-11')).toBe(true);
    expect(esFechaLocal('2026-02-31')).toBe(false);
    expect(esFechaLocal('2026-13-01')).toBe(false);
    expect(esFechaLocal('11/09/2026')).toBe(false);
    expect(esFechaLocal('')).toBe(false);
  });

  it('rechaza una fecha mal formada en vez de inventar un resultado', () => {
    expect(() => sumarMeses('11/09/2026', 1)).toThrow(/Fecha local inválida/);
  });
});
