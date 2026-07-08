import { ClinicalNote } from './clinical-note.entity';
import { NOM004Validator } from './nom004-validator';
import { IncompleteClinicalNoteError, NoteAlreadyClosedError } from './clinical-note.errors';
import {
  EMPTY_NOTA_EVOLUCION,
  type FirmaMedica,
  type NotaEvolucionContent,
} from '@healthflow/shared-types';

const FIRMA: FirmaMedica = {
  medicoNombre: 'Dra. Cervantes',
  cedula: '7841203',
  fecha: '2026-07-06T10:00:00Z',
};

function completa(): NotaEvolucionContent {
  return {
    tipoNota: 'nota_evolucion',
    padecimientoActual: '<p>Refiere mejoría del cuadro.</p>',
    exploracionFisica: {
      signosVitales: { ...EMPTY_NOTA_EVOLUCION.exploracionFisica.signosVitales, ta: '120/80' },
      hallazgos: '',
    },
    diagnosticos: [{ cie10: 'E11.9', descripcion: 'Diabetes mellitus tipo 2' }],
    planTerapeutico: 'Continuar metformina 850 mg c/12h.',
  };
}

function draft(): ClinicalNote {
  return ClinicalNote.fromState({
    id: 'n1',
    clinicalRecordId: 'r1',
    appointmentId: 'a1',
    doctorId: 'd1',
    tipoNota: 'nota_evolucion',
    estatus: 'borrador',
    contenido: EMPTY_NOTA_EVOLUCION,
    cerradoEn: null,
  });
}

describe('NOM004Validator.validateNotaEvolucion', () => {
  it('una nota completa no reporta faltantes', () => {
    expect(NOM004Validator.validateNotaEvolucion(completa())).toEqual([]);
  });

  it('detecta todos los campos obligatorios faltantes en una nota vacía', () => {
    const missing = NOM004Validator.validateNotaEvolucion(EMPTY_NOTA_EVOLUCION);
    expect(missing).toEqual(
      expect.arrayContaining(['padecimientoActual', 'signosVitales.ta', 'diagnosticos', 'planTerapeutico']),
    );
  });

  it('trata el HTML vacío de TipTap como campo sin contenido', () => {
    const c = completa();
    c.padecimientoActual = '<p></p>';
    expect(NOM004Validator.validateNotaEvolucion(c)).toContain('padecimientoActual');
  });

  it('un diagnóstico sin código CIE-10 no cuenta', () => {
    const c = completa();
    c.diagnosticos = [{ cie10: '  ', descripcion: 'algo' }];
    expect(NOM004Validator.validateNotaEvolucion(c)).toContain('diagnosticos');
  });
});

describe('ClinicalNote (inmutabilidad y cierre)', () => {
  it('cierra una nota completa, estampa firma y fecha', () => {
    const note = draft();
    const now = new Date('2026-07-06T10:00:00Z');
    note.close(completa(), FIRMA, now);
    expect(note.estatus).toBe('cerrada');
    expect(note.cerradoEn).toEqual(now);
    expect(note.contenido.firma).toEqual(FIRMA);
  });

  it('rechaza el cierre si faltan campos (IncompleteClinicalNoteError con missing)', () => {
    const note = draft();
    try {
      note.close(EMPTY_NOTA_EVOLUCION, FIRMA);
      fail('debió lanzar');
    } catch (err) {
      expect(err).toBeInstanceOf(IncompleteClinicalNoteError);
      expect((err as IncompleteClinicalNoteError).missing).toContain('planTerapeutico');
    }
    expect(note.estatus).toBe('borrador'); // no se cerró
  });

  it('una nota cerrada es inmutable: saveDraft y close lanzan NoteAlreadyClosedError', () => {
    const note = draft();
    note.close(completa(), FIRMA);
    expect(() => note.saveDraft(completa())).toThrow(NoteAlreadyClosedError);
    expect(() => note.close(completa(), FIRMA)).toThrow(NoteAlreadyClosedError);
  });
});
