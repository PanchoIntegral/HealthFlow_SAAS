import {
  CONFIG_RECETA_DEFAULT,
  SECCIONES_RECETA,
  normalizarOrdenSecciones,
} from '@healthflow/shared-types';

/**
 * El orden viaja dentro de un jsonb ya guardado: no basta con validarlo al
 * entrar, porque también llega de configuraciones escritas por versiones
 * anteriores. Estas pruebas cubren que ninguna de esas formas pueda imprimir
 * una receta sin diagnóstico o con un bloque repetido.
 */
describe('normalizarOrdenSecciones', () => {
  it('respeta el orden que eligió la clínica', () => {
    expect(normalizarOrdenSecciones(['prescripcion', 'indicaciones', 'diagnostico'])).toEqual([
      'prescripcion',
      'indicaciones',
      'diagnostico',
    ]);
  });

  it('completa las secciones que falten, al final', () => {
    // Config guardada antes de que existiera una sección nueva.
    expect(normalizarOrdenSecciones(['prescripcion'])).toEqual([
      'prescripcion',
      'diagnostico',
      'indicaciones',
    ]);
  });

  it('descarta repetidos y claves desconocidas', () => {
    expect(
      normalizarOrdenSecciones(['diagnostico', 'diagnostico', 'inventada', 'prescripcion']),
    ).toEqual(['diagnostico', 'prescripcion', 'indicaciones']);
  });

  it('sin configuración devuelve el orden por omisión', () => {
    expect(normalizarOrdenSecciones(undefined)).toEqual([...SECCIONES_RECETA]);
    expect(normalizarOrdenSecciones([])).toEqual([...SECCIONES_RECETA]);
  });

  it('siempre imprime todas las secciones, pase lo que pase', () => {
    for (const entrada of [undefined, [], ['x'], ['diagnostico'], ['prescripcion', 'prescripcion']]) {
      expect(normalizarOrdenSecciones(entrada)).toHaveLength(SECCIONES_RECETA.length);
    }
  });

  it('el default del sistema ya está normalizado', () => {
    expect(normalizarOrdenSecciones(CONFIG_RECETA_DEFAULT.ordenSecciones)).toEqual(
      CONFIG_RECETA_DEFAULT.ordenSecciones,
    );
  });
});
