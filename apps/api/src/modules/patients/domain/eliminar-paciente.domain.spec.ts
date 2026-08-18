import type { ActividadClinicaPaciente } from '@healthflow/shared-types';
import { PacienteConHistorialClinicoError } from './patient.errors';

const vacia = (): ActividadClinicaPaciente => ({
  notas: 0,
  recetas: 0,
  consentimientos: 0,
  radiografias: 0,
  presupuestos: 0,
  facturas: 0,
  citasAtendidas: 0,
  ordenesPlantillas: 0,
  datosFiscales: 0,
});

/**
 * La regla que decide si un paciente se puede borrar es una suma sobre este
 * objeto. Se prueba aquí, sin base de datos, porque es la única barrera real:
 * `patients` sí concede DELETE al rol de la app y nueve tablas cuelgan con
 * ON DELETE CASCADE, incluidas `recetas` y `consentimientos`, que se hicieron
 * insert-only precisamente para no poder borrarse. Si esta suma se equivoca,
 * el CASCADE destruye documentos médico-legales sin que nada más lo impida.
 */
const puedeBorrarse = (a: ActividadClinicaPaciente) =>
  Object.values(a).reduce((x, y) => x + y, 0) === 0;

describe('Regla de borrado de paciente', () => {
  it('permite borrar un paciente sin ninguna actividad clínica', () => {
    expect(puedeBorrarse(vacia())).toBe(true);
  });

  // Cada tipo de actividad por separado: basta UNA para que exista expediente.
  it.each([
    ['notas'],
    ['recetas'],
    ['consentimientos'],
    ['radiografias'],
    ['presupuestos'],
    ['facturas'],
    ['citasAtendidas'],
    ['ordenesPlantillas'],
    ['datosFiscales'],
  ] as [keyof ActividadClinicaPaciente][])('bloquea si hay %s', (campo) => {
    expect(puedeBorrarse({ ...vacia(), [campo]: 1 })).toBe(false);
  });
});

describe('PacienteConHistorialClinicoError', () => {
  it('enumera solo lo que existe y explica la alternativa', () => {
    const e = new PacienteConHistorialClinicoError({ ...vacia(), notas: 3, recetas: 1 });
    expect(e.message).toContain('3 notas clínicas');
    expect(e.message).toContain('1 receta');
    expect(e.message).not.toContain('0 ');
    expect(e.message).toContain('NOM-004');
    expect(e.message).toContain('archívalo');
    expect(e.httpStatus).toBe(409);
  });

  it('concuerda el singular: "1 receta", nunca "1 recetas"', () => {
    const e = new PacienteConHistorialClinicoError({ ...vacia(), recetas: 1 });
    expect(e.message).not.toContain('1 recetas');
  });

  it('expone el detalle para que la UI diga qué existe', () => {
    const e = new PacienteConHistorialClinicoError({ ...vacia(), facturas: 2 });
    expect(e.details()).toEqual({ actividad: { ...vacia(), facturas: 2 } });
  });
});
