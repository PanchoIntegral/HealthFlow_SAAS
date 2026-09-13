import { EMPTY_HISTORIA_CLINICA } from '@healthflow/shared-types';
import { decidirContexto } from './contexto-nota';
import { ClinicalNote } from './clinical-note.entity';

describe('decidirContexto (primera valoración por especialidad)', () => {
  const sin = { historiaGeneral: false, inicialEspecialidad: false };

  it('sin historia general cerrada, abre la historia clínica general', () => {
    expect(decidirContexto('cardiologia', sin)).toEqual({ tipoNota: 'historia_clinica', contextoNota: 'general' });
    expect(decidirContexto('general', sin)).toEqual({ tipoNota: 'historia_clinica', contextoNota: 'general' });
  });

  it('con historia general pero sin valoración de la especialidad, abre la inicial de especialidad', () => {
    expect(decidirContexto('cardiologia', { historiaGeneral: true, inicialEspecialidad: false })).toEqual({
      tipoNota: 'historia_clinica',
      contextoNota: 'inicial_especialidad',
    });
    expect(decidirContexto('nutricion', { historiaGeneral: true, inicialEspecialidad: false }).contextoNota).toBe(
      'inicial_especialidad',
    );
  });

  it('con ambas, es seguimiento', () => {
    expect(decidirContexto('cardiologia', { historiaGeneral: true, inicialEspecialidad: true })).toEqual({
      tipoNota: 'nota_evolucion',
      contextoNota: 'seguimiento',
    });
  });

  it('en medicina general la historia general ya es la valoración inicial', () => {
    expect(decidirContexto('general', { historiaGeneral: true, inicialEspecialidad: false })).toEqual({
      tipoNota: 'nota_evolucion',
      contextoNota: 'seguimiento',
    });
  });
});

describe('ClinicalNote: especialidad de una nota versionada', () => {
  function borrador(plantillaVersion?: 'v1') {
    return ClinicalNote.fromState({
      id: 'n1',
      clinicalRecordId: 'r1',
      appointmentId: 'a1',
      doctorId: 'd1',
      tipoNota: 'historia_clinica',
      estatus: 'borrador',
      contenido: {
        ...EMPTY_HISTORIA_CLINICA,
        especialidad: 'cardiologia',
        ...(plantillaVersion ? { plantillaVersion, contextoNota: 'inicial_especialidad' as const } : {}),
      },
      cerradoEn: null,
      createdAt: new Date('2026-09-13T09:00:00Z'),
    });
  }

  it('v1 conserva la especialidad estampada aunque el médico cambie la suya', () => {
    const note = borrador('v1');
    note.saveDraft(EMPTY_HISTORIA_CLINICA, 'nutricion');
    expect(note.contenido).toMatchObject({ especialidad: 'cardiologia', contextoNota: 'inicial_especialidad' });
  });

  it('legacy sigue la especialidad actual mientras sea borrador, como antes', () => {
    const note = borrador();
    note.saveDraft(EMPTY_HISTORIA_CLINICA, 'nutricion');
    expect(note.contenido.especialidad).toBe('nutricion');
    expect(note.contenido.plantillaVersion).toBeUndefined();
  });
});
