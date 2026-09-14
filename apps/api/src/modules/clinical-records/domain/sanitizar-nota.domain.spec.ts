import { EMPTY_HISTORIA_CLINICA, PERFILES, type NotaEvolucionContent } from '@healthflow/shared-types';
import { sanitizarNota } from './sanitizar-nota';
import { ClinicalNote } from './clinical-note.entity';

const XSS = '<img src=x onerror=alert(1)><script>alert(2)</script>';

function sucia(): NotaEvolucionContent {
  return {
    ...EMPTY_HISTORIA_CLINICA,
    especialidad: 'cardiologia',
    padecimientoActual: `<p onclick="x()">Disnea</p>${XSS}<a href="javascript:alert(3)">ver</a>`,
    planTerapeutico: `<p>Plan</p>${XSS}`,
    antecedentesHeredofamiliares: `Madre DM2${XSS}`,
    exploracionFisica: {
      signosVitales: { ...EMPTY_HISTORIA_CLINICA.exploracionFisica.signosVitales, ta: `120/80${XSS}` },
      hallazgos: `Soplo <b onmouseover=x>sistólico</b> TA < 140`,
    },
    diagnosticos: [{ cie10: 'I10', descripcion: `Hipertensión${XSS}` }],
    extension: {
      car_sintomas: `<p>Palpitaciones</p>${XSS}`, // texto-rico
      car_ta_brazo_der: `130/80${XSS}`, // texto
    },
    noCapturado: { 'extension.car_ecg': { estado: 'no_valorado', motivo: `Sin equipo${XSS}` } },
    verificacionAntecedentes: { estado: 'no_fue_posible_verificar', motivo: `Urgencia${XSS}` },
    bloques: {
      medicamentos: { items: [{ id: 'm1', nombre: `Enalapril${XSS}`, cambio: 'sin_cambio' }] },
      riesgoCv: [{ algoritmo: `Globorisk${XSS}`, version: '1', fecha: '2026-09-13', entradas: [{ clave: `edad${XSS}`, valor: 58 }], resultado: 12, unidad: '%' }],
    },
  };
}

describe('sanitizarNota', () => {
  const limpia = sanitizarNota(sucia(), PERFILES.cardiologia);
  const serializada = JSON.stringify(limpia);

  it('no deja scripts, handlers ni URLs ejecutables en ninguna parte del contenido', () => {
    expect(serializada).not.toMatch(/<\s*(script|img|a)\b/i);
    expect(serializada).not.toMatch(/on(error|click|mouseover)\s*=/i);
    expect(serializada).not.toMatch(/javascript:/i);
    expect(serializada).not.toContain('alert(2)'); // ni el código de un script como texto
  });

  it('los campos enriquecidos conservan su formato permitido', () => {
    expect(limpia.padecimientoActual).toBe('<p>Disnea</p>ver');
    expect(limpia.planTerapeutico).toBe('<p>Plan</p>');
    expect(limpia.extension?.car_sintomas).toBe('<p>Palpitaciones</p>');
  });

  it('los campos de texto simple se limpian sin escapar el texto', () => {
    expect(limpia.exploracionFisica.hallazgos).toBe('Soplo sistólico TA < 140');
    expect(limpia.exploracionFisica.signosVitales.ta).toBe('120/80');
    expect(limpia.extension?.car_ta_brazo_der).toBe('130/80');
    expect(limpia.diagnosticos[0]!.descripcion).toBe('Hipertensión');
    expect(limpia.bloques?.medicamentos?.items[0]!.nombre).toBe('Enalapril');
  });

  it('respeta tipos no textuales y la estructura', () => {
    expect(limpia.bloques?.riesgoCv?.[0]).toMatchObject({ resultado: 12, entradas: [{ valor: 58 }] });
    expect(limpia.verificacionAntecedentes?.estado).toBe('no_fue_posible_verificar');
    expect(Object.keys(limpia.noCapturado ?? {})).toEqual(['extension.car_ecg']);
  });

  it('es idempotente: sanear dos veces no cambia nada', () => {
    expect(sanitizarNota(limpia, PERFILES.cardiologia)).toEqual(limpia);
  });
});

describe('ClinicalNote: lo que se guarda ya está saneado', () => {
  function borrador() {
    return ClinicalNote.fromState({
      id: 'n1',
      clinicalRecordId: 'r1',
      appointmentId: 'a1',
      doctorId: 'd1',
      tipoNota: 'historia_clinica',
      estatus: 'borrador',
      contenido: { ...EMPTY_HISTORIA_CLINICA, especialidad: 'cardiologia' },
      cerradoEn: null,
      createdAt: new Date('2026-09-13T09:00:00Z'),
    });
  }

  it('en el autosave', () => {
    const note = borrador();
    note.saveDraft(sucia(), 'cardiologia');
    expect(JSON.stringify(note.contenido)).not.toMatch(/<\s*script|onerror|javascript:/i);
  });

  it('en el cierre, y lo firmado es lo saneado', () => {
    const note = borrador();
    const contenido = {
      ...sucia(),
      diagnosticos: [{ cie10: 'I10', descripcion: 'Hipertensión' }],
      antecedentesPersonalesPatologicos: 'Negados',
      antecedentesPersonalesNoPatologicos: 'Negados',
    };
    note.close(contenido, { medicoNombre: 'Dr. X', cedula: '123', fecha: '2026-09-13' }, new Date(), 'cardiologia');
    expect(note.estatus).toBe('cerrada');
    expect(JSON.stringify(note.contenido)).not.toMatch(/<\s*script|onerror|javascript:/i);
    expect(note.contenido.padecimientoActual).toBe('<p>Disnea</p>ver');
  });
});
