import {
  EMPTY_HISTORIA_CLINICA,
  EMPTY_NOTA_EVOLUCION,
  plantillaDe,
  type NotaEvolucionContent,
} from '@healthflow/shared-types';
import { LIMITES_NOTA, validarEstructuraNota } from './estructura-nota';
import { ClinicalNote } from './clinical-note.entity';
import { EstructuraNotaInvalidaError } from './clinical-note.errors';

function nota(parcial: Partial<NotaEvolucionContent> = {}): NotaEvolucionContent {
  return { ...EMPTY_NOTA_EVOLUCION, ...parcial };
}

describe('validarEstructuraNota', () => {
  it('acepta los contenidos vacíos de siempre (nota vieja reabierta)', () => {
    expect(validarEstructuraNota(EMPTY_NOTA_EVOLUCION)).toEqual([]);
    expect(validarEstructuraNota(EMPTY_HISTORIA_CLINICA)).toEqual([]);
  });

  it('rechaza lo que no es un objeto', () => {
    expect(validarEstructuraNota(null)).toEqual(['contenido']);
    expect(validarEstructuraNota([])).toEqual(['contenido']);
  });

  it('ignora claves desconocidas en vez de rechazarlas', () => {
    expect(validarEstructuraNota({ ...EMPTY_NOTA_EVOLUCION, estadoUi: { abierto: true } })).toEqual([]);
  });

  it('marca tipos y tamaños inválidos por ruta, sin incluir valores', () => {
    const errores = validarEstructuraNota({
      ...EMPTY_NOTA_EVOLUCION,
      padecimientoActual: 'x'.repeat(LIMITES_NOTA.textoRico + 1),
      diagnosticos: [{ cie10: 42, descripcion: 'dato sensible' }],
      extension: { car_fraccion_eyeccion: Number.NaN, nut_objetivo: { a: 1 } },
    });
    expect(errores).toEqual([
      'padecimientoActual',
      'diagnosticos.0',
      'extension.car_fraccion_eyeccion',
      'extension.nut_objetivo',
    ]);
    expect(errores.join()).not.toContain('dato sensible');
  });

  it('noCapturado exige un estado del catálogo y motivo acotado', () => {
    expect(
      validarEstructuraNota(
        nota({ noCapturado: { 'signosVitales.ta': { estado: 'no_valorado', motivo: 'Teleconsulta' } } }),
      ),
    ).toEqual([]);
    expect(
      validarEstructuraNota({
        ...EMPTY_NOTA_EVOLUCION,
        noCapturado: {
          'signosVitales.ta': { estado: '' },
          'extension.car_ecg': { estado: 'no_aplica', motivo: 'x'.repeat(LIMITES_NOTA.motivo + 1) },
        },
      }),
    ).toEqual(['noCapturado.signosVitales.ta', 'noCapturado.extension.car_ecg']);
  });

  it('valida bloques estructurados completos', () => {
    expect(
      validarEstructuraNota(
        nota({
          bloques: {
            problemas: { items: [], declaracion: 'sin_problemas_activos' },
            medicamentos: {
              items: [{ id: 'm1', nombre: 'Metformina', dosis: '850 mg', cambio: 'sin_cambio', adherencia: 'adecuada' }],
            },
            estudios: {
              items: [{ id: 'e1', tipo: 'ecg', nombre: 'ECG de reposo', fecha: '2026-09-01', solicitado: false }],
            },
            seguimiento: { declaracion: 'seguimiento_no_requerido', motivo: 'Alta' },
            riesgoCv: [
              {
                algoritmo: 'Globorisk',
                version: '2017',
                fecha: '2026-09-13',
                entradas: [{ clave: 'edad', valor: 58, unidad: 'años' }],
                resultado: 12.4,
                unidad: '% a 10 años',
              },
            ],
            pes: [{ problema: 'Ingesta excesiva de energía', etiologia: 'Horarios', signosSintomas: 'IMC 31' }],
            alergiasVerificadasEn: '2026-09-13T10:00:00Z',
          },
        }),
      ),
    ).toEqual([]);
  });

  it('rechaza catálogos inventados y riesgo CV sin lo que lo hace reproducible', () => {
    const errores = validarEstructuraNota({
      ...EMPTY_NOTA_EVOLUCION,
      bloques: {
        problemas: { items: [{ id: 'p1', descripcion: 'HTA', estado: 'grave' }], declaracion: 'ninguno' },
        estudios: { items: [{ id: 'e1', tipo: 'resonancia_cuantica', nombre: 'x' }] },
        riesgoCv: [{ algoritmo: 'Globorisk', resultado: 'alto' }],
        alergiasVerificadasEn: 'ayer',
      },
    });
    expect(errores).toEqual([
      'bloques.problemas',
      'bloques.estudios.0',
      'bloques.riesgoCv.0',
      'bloques.alergiasVerificadasEn',
    ]);
  });
});

describe('plantillaDe', () => {
  it('una nota sin versión, o con una desconocida, se lee como legacy-v0', () => {
    expect(plantillaDe({})).toBe('legacy-v0');
    expect(plantillaDe({ plantillaVersion: 'v9' as never })).toBe('legacy-v0');
    expect(plantillaDe({ plantillaVersion: 'v1' })).toBe('v1');
  });
});

describe('ClinicalNote: campos sellados por el servidor', () => {
  function borradorHistoria(): ClinicalNote {
    return ClinicalNote.fromState({
      id: 'n1',
      clinicalRecordId: 'r1',
      appointmentId: 'a1',
      doctorId: 'd1',
      tipoNota: 'historia_clinica',
      estatus: 'borrador',
      contenido: { ...EMPTY_HISTORIA_CLINICA, especialidad: 'cardiologia', plantillaVersion: 'v1', contextoNota: 'general' },
      cerradoEn: null,
      createdAt: new Date('2026-09-13T09:00:00Z'),
    });
  }

  it('el cliente no puede cambiar tipo, plantilla, contexto ni firmar desde el autosave', () => {
    const note = borradorHistoria();
    note.saveDraft(
      nota({
        tipoNota: 'nota_evolucion',
        plantillaVersion: 'legacy-v0',
        contextoNota: 'seguimiento',
        especialidad: 'nutricion',
        firma: { medicoNombre: 'Falso', cedula: '1', fecha: '2026-01-01' },
      }),
      'cardiologia',
    );
    expect(note.contenido).toMatchObject({
      tipoNota: 'historia_clinica',
      plantillaVersion: 'v1',
      contextoNota: 'general',
      especialidad: 'cardiologia',
    });
    expect(note.contenido.firma).toBeUndefined();
  });

  it('una historia clínica disfrazada de evolución sigue exigiendo antecedentes al cerrar', () => {
    const note = borradorHistoria();
    const disfrazada = nota({
      tipoNota: 'nota_evolucion',
      padecimientoActual: '<p>Disnea</p>',
      exploracionFisica: {
        signosVitales: { ...EMPTY_NOTA_EVOLUCION.exploracionFisica.signosVitales, ta: '130/85' },
      },
      diagnosticos: [{ cie10: 'R06.0', descripcion: 'Disnea' }],
      planTerapeutico: '<p>Ecocardiograma</p>',
    });
    expect(() =>
      note.close(disfrazada, { medicoNombre: 'Dra. X', cedula: '123', fecha: '2026-09-13' }),
    ).toThrow(expect.objectContaining({ missing: expect.arrayContaining(['antecedentesHeredofamiliares']) }));
    expect(note.estatus).toBe('borrador');
  });

  it('un contenido con forma inválida no se guarda', () => {
    const note = borradorHistoria();
    expect(() => note.saveDraft({ ...EMPTY_NOTA_EVOLUCION, diagnosticos: 'I10' } as never)).toThrow(
      EstructuraNotaInvalidaError,
    );
  });
});
