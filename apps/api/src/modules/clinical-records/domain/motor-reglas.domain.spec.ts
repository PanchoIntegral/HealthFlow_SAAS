import {
  EMPTY_NOTA_EVOLUCION,
  PERFILES,
  type NotaEvolucionContent,
  type PerfilEspecialidad,
} from '@healthflow/shared-types';
import { evaluarEsquema, reglaAplica, validarCierre } from './motor-reglas';
import { ClinicalNote } from './clinical-note.entity';
import { IncompleteClinicalNoteError } from './clinical-note.errors';

/**
 * Los perfiles de estas pruebas son SINTÉTICOS a propósito: prueban la
 * mecánica del motor, no reglas clínicas. Las reglas reales las define y
 * aprueba el responsable clínico en el catálogo.
 */
const perfilPrueba: PerfilEspecialidad = {
  key: 'cardiologia',
  nombre: 'Perfil de prueba',
  rangosCie10: [],
  signosVitales: ['ta'],
  camposExtra: [
    {
      key: 'x_inicial',
      label: 'Campo de primera valoración',
      tipo: 'texto',
      obligatorio: true, // lo que vale en legacy-v0
      reglas: [{ id: 'r-inicial', cuando: { contextosNota: ['inicial_especialidad'] }, requisito: 'requerido' }],
      estadosPermitidos: ['no_aplica', 'no_valorado'],
      requiereMotivoNoCapturado: true,
    },
    {
      key: 'x_por_dx',
      label: 'Campo por diagnóstico',
      tipo: 'numero',
      min: 0,
      max: 100,
      reglas: [{ id: 'r-dx', cuando: { diagnosticosCie10: ['I50'] }, requisito: 'requerido' }],
      estadosPermitidos: ['no_valorado'],
    },
    {
      key: 'x_por_motivo',
      label: 'Campo por motivo',
      tipo: 'texto',
      reglas: [{ id: 'r-motivo', cuando: { motivos: ['motivo_a'], tiposNota: ['nota_evolucion'] }, requisito: 'requerido' }],
    },
  ],
  bloques: [
    {
      bloque: 'medicamentos',
      label: 'Conciliación',
      reglas: [{ id: 'r-med', cuando: { contextosNota: ['inicial_especialidad'] }, requisito: 'requerido' }],
    },
    { bloque: 'seguimiento', label: 'Seguimiento', obligatorio: true },
  ],
};

function nota(over: Partial<NotaEvolucionContent> = {}): NotaEvolucionContent {
  return {
    ...EMPTY_NOTA_EVOLUCION,
    padecimientoActual: '<p>Control</p>',
    exploracionFisica: {
      signosVitales: { ...EMPTY_NOTA_EVOLUCION.exploracionFisica.signosVitales, ta: '120/80' },
    },
    diagnosticos: [{ cie10: 'I10', descripcion: 'Hipertensión esencial' }],
    planTerapeutico: '<p>Continuar</p>',
    plantillaVersion: 'v1',
    bloques: { seguimiento: { plazo: '3 meses' } },
    ...over,
  };
}

function rutas(contenido: NotaEvolucionContent): string[] {
  return validarCierre(contenido, evaluarEsquema(contenido, perfilPrueba), perfilPrueba).map((e) => e.ruta);
}

describe('motor de reglas', () => {
  describe('evaluarEsquema', () => {
    it('en v1 las reglas deciden: un seguimiento no pide lo de primera valoración', () => {
      const esquema = evaluarEsquema(nota({ contextoNota: 'seguimiento' }), perfilPrueba);
      const requisitos = Object.fromEntries(esquema.campos.map((c) => [c.ruta, c.requisito]));
      expect(requisitos).toMatchObject({
        padecimientoActual: 'requerido',
        'extension.x_inicial': 'opcional',
        'extension.x_por_dx': 'opcional',
        'bloques.medicamentos': 'opcional',
        'bloques.seguimiento': 'requerido',
      });
    });

    it('guarda qué regla activó cada requisito', () => {
      const esquema = evaluarEsquema(nota({ contextoNota: 'inicial_especialidad' }), perfilPrueba);
      expect(esquema.campos.find((c) => c.ruta === 'extension.x_inicial')).toMatchObject({
        requisito: 'requerido',
        reglaId: 'r-inicial',
        estadosPermitidos: ['no_aplica', 'no_valorado'],
        requiereMotivo: true,
      });
      expect(esquema).toMatchObject({ plantillaVersion: 'v1', contextoNota: 'inicial_especialidad' });
    });

    it('una nota legacy-v0 ignora las reglas y usa `obligatorio`, como antes', () => {
      const esquema = evaluarEsquema(nota({ plantillaVersion: undefined, contextoNota: 'seguimiento' }), perfilPrueba);
      expect(esquema.plantillaVersion).toBe('legacy-v0');
      expect(esquema.campos.find((c) => c.ruta === 'extension.x_inicial')?.requisito).toBe('requerido');
      expect(esquema.campos.find((c) => c.ruta === 'bloques.medicamentos')?.requisito).toBe('opcional');
    });

    it('la T/A sólo admite declarar omisión en perfiles que lo permiten', () => {
      const ta = (p: PerfilEspecialidad) =>
        evaluarEsquema(nota(), p).campos.find((c) => c.ruta === 'signosVitales.ta')?.estadosPermitidos;
      expect(ta(perfilPrueba)).toEqual([]);
      expect(ta({ ...perfilPrueba, permiteOmitirSignosVitales: true })).toEqual(['no_valorado']);
    });
  });

  describe('reglaAplica', () => {
    const regla = (cuando: Parameters<typeof reglaAplica>[0]['cuando']) => ({ id: 'r', cuando, requisito: 'requerido' as const });

    it('compara CIE-10 por prefijo, sin importar puntos ni mayúsculas', () => {
      const conDx = nota({ diagnosticos: [{ cie10: 'i50.9', descripcion: 'Insuficiencia cardiaca' }] });
      expect(reglaAplica(regla({ diagnosticosCie10: ['I50'] }), conDx)).toBe(true);
      expect(reglaAplica(regla({ diagnosticosCie10: ['I5'] }), nota())).toBe(false);
    });

    it('exige todas las condiciones presentes a la vez', () => {
      const r = regla({ motivos: ['motivo_a'], tiposNota: ['nota_evolucion'] });
      expect(reglaAplica(r, nota({ motivoConsulta: 'motivo_a' }))).toBe(true);
      expect(reglaAplica(r, nota({ motivoConsulta: 'motivo_a', tipoNota: 'historia_clinica' }))).toBe(false);
      expect(reglaAplica(r, nota())).toBe(false); // sin motivo capturado no se infiere
    });

    it('sin contexto estampado, una regla por contexto no aplica', () => {
      expect(reglaAplica(regla({ contextosNota: ['general'] }), nota())).toBe(false);
    });
  });

  describe('validarCierre', () => {
    const inicial = (over: Partial<NotaEvolucionContent> = {}) =>
      nota({
        contextoNota: 'inicial_especialidad',
        extension: { x_inicial: 'Dato' },
        bloques: { seguimiento: { plazo: '1 mes' }, medicamentos: { items: [], declaracion: 'sin_medicamentos' } },
        ...over,
      });

    it('cierra una primera valoración completa', () => {
      expect(rutas(inicial())).toEqual([]);
    });

    it('un campo requerido vacío no se cierra; con estado permitido y motivo, sí', () => {
      const vacio = inicial({ extension: { x_inicial: '<p></p>' } });
      expect(rutas(vacio)).toEqual(['extension.x_inicial']);

      const declarado = inicial({
        extension: {},
        noCapturado: { 'extension.x_inicial': { estado: 'no_aplica', motivo: 'Referido con estudio completo' } },
      });
      expect(rutas(declarado)).toEqual([]);
    });

    it('distingue estado no permitido y motivo faltante con códigos estables', () => {
      const base = inicial({ extension: {} });
      const errores = (noCapturado: NotaEvolucionContent['noCapturado']) =>
        validarCierre({ ...base, noCapturado }, evaluarEsquema({ ...base, noCapturado }, perfilPrueba), perfilPrueba);

      expect(errores({ 'extension.x_inicial': { estado: 'rechazado_por_paciente', motivo: 'x' } })).toEqual([
        { codigo: 'ESTADO_NO_PERMITIDO', ruta: 'extension.x_inicial', reglaId: 'r-inicial' },
      ]);
      expect(errores({ 'extension.x_inicial': { estado: 'no_valorado', motivo: '  ' } })).toEqual([
        { codigo: 'MOTIVO_REQUERIDO', ruta: 'extension.x_inicial', reglaId: 'r-inicial' },
      ]);
      expect(errores(undefined)).toEqual([
        { codigo: 'CAMPO_REQUERIDO', ruta: 'extension.x_inicial', reglaId: 'r-inicial' },
      ]);
    });

    it('el requisito por diagnóstico sólo aparece con ese diagnóstico', () => {
      const conIc = nota({ diagnosticos: [{ cie10: 'I50.0', descripcion: 'IC congestiva' }] });
      expect(rutas(conIc)).toEqual(['extension.x_por_dx']);
      expect(rutas({ ...conIc, extension: { x_por_dx: 0 } })).toEqual([]); // 0 es un dato
      expect(rutas({ ...conIc, extension: { x_por_dx: 140 } })).toEqual(['extension.x_por_dx']);
    });

    it('una lista vacía sin declaración no cuenta; "no fue posible" exige motivo', () => {
      const med = (medicamentos: NonNullable<NotaEvolucionContent['bloques']>['medicamentos']) =>
        rutas(inicial({ bloques: { seguimiento: { plazo: '1 mes' }, medicamentos } }));
      expect(med({ items: [] })).toEqual(['bloques.medicamentos']);
      expect(med({ items: [], declaracion: 'no_fue_posible_conciliar' })).toEqual(['bloques.medicamentos']);
      expect(med({ items: [], declaracion: 'no_fue_posible_conciliar', motivo: 'Paciente no trae lista' })).toEqual([]);
    });

    it('"seguimiento no requerido" necesita justificación', () => {
      expect(rutas(nota({ bloques: { seguimiento: { declaracion: 'seguimiento_no_requerido' } } }))).toEqual([
        'bloques.seguimiento',
      ]);
      expect(
        rutas(nota({ bloques: { seguimiento: { declaracion: 'seguimiento_no_requerido', motivo: 'Alta' } } })),
      ).toEqual([]);
    });

    it('un cambio de tratamiento sin razón no se firma, aunque el bloque sea opcional', () => {
      const c = nota({
        bloques: {
          seguimiento: { plazo: '1 mes' },
          medicamentos: { items: [{ id: 'm1', nombre: 'Enalapril', cambio: 'ajusta' }] },
        },
      });
      expect(validarCierre(c, evaluarEsquema(c, perfilPrueba), perfilPrueba)).toEqual([
        { codigo: 'MOTIVO_REQUERIDO', ruta: 'bloques.medicamentos.0.razonCambio' },
      ]);
    });

    it('una cadena vacía nunca equivale a "no aplica"', () => {
      const c = inicial({ extension: { x_inicial: '' }, noCapturado: {} });
      expect(rutas(c)).toEqual(['extension.x_inicial']);
    });
  });

  describe('cierre de la entidad', () => {
    function borrador(contenido: NotaEvolucionContent): ClinicalNote {
      return ClinicalNote.fromState({
        id: 'n1',
        clinicalRecordId: 'r1',
        appointmentId: 'a1',
        doctorId: 'd1',
        tipoNota: 'nota_evolucion',
        estatus: 'borrador',
        contenido,
        cerradoEn: null,
        createdAt: new Date('2026-09-13T09:00:00Z'),
      });
    }
    const firma = { medicoNombre: 'Dra. X', cedula: '123', fecha: '2026-09-13T10:00:00Z' };

    it('congela el esquema evaluado junto con la firma', () => {
      const c = nota({ plantillaVersion: undefined, especialidad: 'general' });
      const note = borrador(c);
      note.close(c, firma, new Date(), 'general');
      expect(note.contenido.esquemaAlCierre).toEqual(evaluarEsquema({ ...c, tipoNota: 'nota_evolucion' }, PERFILES.general));
    });

    it('expone códigos además de las rutas al rechazar el cierre', () => {
      const c = nota({ planTerapeutico: '', especialidad: 'general' });
      const note = borrador(c);
      try {
        note.close(c, firma, new Date(), 'general');
        fail('debió lanzar');
      } catch (err) {
        expect(err).toBeInstanceOf(IncompleteClinicalNoteError);
        expect((err as IncompleteClinicalNoteError).details()).toEqual({
          missing: ['planTerapeutico'],
          errores: [{ codigo: 'CAMPO_REQUERIDO', ruta: 'planTerapeutico' }],
        });
      }
    });
  });
});
