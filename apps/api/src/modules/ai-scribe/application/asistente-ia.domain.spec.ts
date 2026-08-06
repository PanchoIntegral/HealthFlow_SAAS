import { PERFILES } from '@healthflow/shared-types';
import { construirPrompt } from './prompt-builder';
import { mapearRespuesta } from './mapear-respuesta';
import { AsistenteIaRespuestaInvalidaError } from '../domain/asistente-ia.errors';

/**
 * Las dos piezas donde vive la calidad clínica del asistente son puras: cómo
 * se le pide al modelo y qué se acepta de vuelta. Se prueban sin red, sin base
 * y sin gastar un peso en inferencia.
 */
describe('Asistente de IA · prompt', () => {
  it('pide solo los signos vitales de la especialidad', () => {
    const prompt = construirPrompt(PERFILES.odontologia, {});

    // Odontología registra T/A y FC (los que condicionan la anestesia).
    expect(prompt).toContain('"ta"');
    expect(prompt).toContain('"fc"');
    // Y no pide los que esa especialidad no toma.
    expect(prompt).not.toContain('"spo2"');
    expect(prompt).not.toContain('"talla"');
  });

  it('incluye los campos propios de la especialidad con sus opciones', () => {
    const prompt = construirPrompt(PERFILES.odontologia, {});

    expect(prompt).toContain('odo_piezas_tratadas');
    // Un campo de selección debe traer su catálogo, o el modelo inventa sinónimos.
    expect(prompt).toContain('Buena | Regular | Deficiente');
  });

  it('prohíbe inventar y exige devolver vacío lo no mencionado', () => {
    const prompt = construirPrompt(PERFILES.general, {});

    expect(prompt).toContain('NUNCA inventes');
    expect(prompt).toContain('null');
  });

  it('advierte que los diagnósticos son sugerencias, no definitivos', () => {
    const prompt = construirPrompt(PERFILES.cardiologia, {});

    expect(prompt).toContain('SUGERENCIAS');
    // Cardiología prioriza su capítulo, sin restringir al resto.
    expect(prompt).toContain('I00–I99');
    expect(prompt).toContain('no te limites');
  });

  it('avisa al modelo qué escribió ya el médico, para que no lo repita', () => {
    const prompt = construirPrompt(PERFILES.general, {
      padecimientoActual: '<p>Dolor abdominal de 3 días.</p>',
    });

    expect(prompt).toContain('YA CAPTURADO POR EL MÉDICO');
    expect(prompt).toContain('padecimientoActual');
  });

  it('un campo con HTML vacío cuenta como NO escrito', () => {
    // TipTap deja "<p></p>" cuando el médico entra al campo y no escribe nada.
    const prompt = construirPrompt(PERFILES.general, { padecimientoActual: '<p></p>' });

    expect(prompt).not.toContain('YA CAPTURADO POR EL MÉDICO');
  });
});

describe('Asistente de IA · respuesta del modelo', () => {
  const perfil = PERFILES.general;

  it('mapea una respuesta completa', () => {
    const { contenido } = mapearRespuesta(
      JSON.stringify({
        padecimientoActual: '<p>Refiere cefalea de 2 días.</p>',
        hallazgos: '<p>Sin datos de focalización.</p>',
        planTerapeutico: '<p>Paracetamol 500 mg cada 8 h por 3 días.</p>',
        signosVitales: { ta: '120/80', fc: '72' },
        diagnosticos: [{ cie10: 'G43.9', descripcion: 'Migraña, no especificada' }],
      }),
      perfil,
    );

    expect(contenido.padecimientoActual).toContain('cefalea');
    expect(contenido.signosVitales).toEqual({ ta: '120/80', fc: '72' });
    expect(contenido.diagnosticos).toHaveLength(1);
  });

  it('omite lo que el modelo no encontró en vez de rellenarlo', () => {
    const { contenido, advertencias } = mapearRespuesta(
      JSON.stringify({
        padecimientoActual: null,
        signosVitales: { ta: null, fc: null },
        diagnosticos: [],
      }),
      perfil,
    );

    expect(contenido.padecimientoActual).toBeUndefined();
    expect(contenido.signosVitales).toBeUndefined();
    expect(contenido.diagnosticos).toBeUndefined();
    expect(advertencias).toContain('No se detectó contenido clínico en el audio.');
  });

  it('acepta el JSON aunque venga envuelto en un bloque de código', () => {
    // Pasa aunque se le pida lo contrario; tirar una transcripción buena por
    // unas comillas de bloque sería absurdo.
    const { contenido } = mapearRespuesta(
      '```json\n{"planTerapeutico":"<p>Reposo relativo.</p>"}\n```',
      perfil,
    );

    expect(contenido.planTerapeutico).toContain('Reposo');
  });

  it('descarta diagnósticos con código CIE-10 mal formado', () => {
    const { contenido } = mapearRespuesta(
      JSON.stringify({
        diagnosticos: [
          { cie10: 'inventado', descripcion: 'Algo' },
          { cie10: 'J00', descripcion: 'Rinofaringitis aguda' },
          { cie10: 'J00', descripcion: 'Duplicado' },
        ],
      }),
      perfil,
    );

    // Un CIE-10 falso contamina los reportes de la clínica: mejor perderlo.
    expect(contenido.diagnosticos).toEqual([
      { cie10: 'J00', descripcion: 'Rinofaringitis aguda' },
    ]);
  });

  it('ignora signos vitales que la especialidad no registra', () => {
    const { contenido } = mapearRespuesta(
      JSON.stringify({ signosVitales: { ta: '110/70', spo2: '98' } }),
      PERFILES.odontologia, // solo ta y fc
    );

    expect(contenido.signosVitales).toEqual({ ta: '110/70' });
  });

  it('descarta un valor de selección que no está en el catálogo', () => {
    const { contenido } = mapearRespuesta(
      JSON.stringify({
        extension: { odo_higiene: 'Más o menos', odo_piezas_tratadas: '16, 26' },
      }),
      PERFILES.odontologia,
    );

    // "Más o menos" no existe en el <select>: entra solo lo que el formulario acepta.
    expect(contenido.extension).toEqual({ odo_piezas_tratadas: '16, 26' });
  });

  it('normaliza un valor de selección con distinta capitalización', () => {
    const { contenido } = mapearRespuesta(
      JSON.stringify({ extension: { odo_higiene: 'buena' } }),
      PERFILES.odontologia,
    );

    expect(contenido.extension).toEqual({ odo_higiene: 'Buena' });
  });

  it('quita etiquetas HTML peligrosas del texto rico', () => {
    const { contenido } = mapearRespuesta(
      JSON.stringify({
        padecimientoActual: '<p>Cefalea</p><script>alert(1)</script><img src=x onerror=1>',
      }),
      perfil,
    );

    // Esto entra a un editor y se guarda en el expediente: se sanea aquí en vez
    // de confiar en que el modelo se portó bien.
    expect(contenido.padecimientoActual).not.toContain('script');
    expect(contenido.padecimientoActual).not.toContain('onerror');
    expect(contenido.padecimientoActual).toContain('Cefalea');
  });

  it('aplana los hallazgos: se capturan en un campo de texto simple', () => {
    const { contenido } = mapearRespuesta(
      JSON.stringify({ hallazgos: '<p>Encías inflamadas.</p><p>Cálculo supragingival.</p>' }),
      perfil,
    );

    // Con HTML aquí el médico vería "<p>" literal dentro de su nota.
    expect(contenido.hallazgos).not.toContain('<');
    expect(contenido.hallazgos).toBe('Encías inflamadas.\nCálculo supragingival.');
  });

  it('convierte a número los campos numéricos de la especialidad', () => {
    const { contenido } = mapearRespuesta(
      JSON.stringify({ extension: { odo_cpod_cariados: '3' } }),
      PERFILES.odontologia,
    );

    expect(contenido.extension).toEqual({ odo_cpod_cariados: 3 });
  });

  it('lanza si la respuesta no es JSON', () => {
    expect(() => mapearRespuesta('lo siento, no puedo ayudarte con eso', perfil)).toThrow(
      AsistenteIaRespuestaInvalidaError,
    );
  });
});
