import { Consentimiento } from './consentimiento.entity';
import { ConsentimientoInvalidoError } from './consentimiento.errors';

const nuevo = (over: Partial<Parameters<typeof Consentimiento.crear>[0]> = {}) =>
  Consentimiento.crear({
    patientId: 'pac-1',
    presupuestoId: null,
    doctorId: 'doc-1',
    procedimiento: 'Extracción dental pieza 36',
    contenido: 'Se explicaron riesgos de sangrado, infección y alternativas de tratamiento.',
    ...over,
  });

describe('Consentimiento', () => {
  it('se crea con los datos válidos', () => {
    const c = nuevo();
    expect(c.toProps()).toMatchObject({
      patientId: 'pac-1',
      procedimiento: 'Extracción dental pieza 36',
    });
  });

  it('rechaza un procedimiento vacío', () => {
    expect(() => nuevo({ procedimiento: '   ' })).toThrow(ConsentimientoInvalidoError);
  });

  it('rechaza contenido vacío', () => {
    expect(() => nuevo({ contenido: '' })).toThrow(ConsentimientoInvalidoError);
  });

  it('recorta espacios sobrantes', () => {
    const c = nuevo({ procedimiento: '  Extracción  ', contenido: '  Riesgos explicados  ' });
    expect(c.toProps().procedimiento).toBe('Extracción');
    expect(c.toProps().contenido).toBe('Riesgos explicados');
  });

  it('acepta un presupuesto vinculado opcional', () => {
    const c = nuevo({ presupuestoId: 'pres-1' });
    expect(c.toProps().presupuestoId).toBe('pres-1');
  });
});
