import {
  CATALOGO_NOTAS_V1,
  EMPTY_HISTORIA_CLINICA,
  EMPTY_NOTA_EVOLUCION,
  ESTADOS_NO_CAPTURADO,
  PERFILES,
  aplicarCatalogo,
  catalogoActivoDe,
  catalogoAprobado,
  perfilDe,
  type CatalogoEspecialidadV1,
  type CatalogoNotas,
  type EspecialidadKey,
  type NotaEvolucionContent,
  type PerfilEspecialidad,
} from '@healthflow/shared-types';
import { evaluarEsquema, validarCierre } from './motor-reglas';
import { motivoParaNoActivar } from './activacion-notas-v2';
import { ClinicalNote } from './clinical-note.entity';
import { EstructuraNotaInvalidaError } from './clinical-note.errors';

const PILOTO: EspecialidadKey[] = ['general', 'cardiologia', 'nutricion'];
const BLOQUES_VALIDOS = ['problemas', 'medicamentos', 'estudios', 'seguimiento', 'riesgoCv', 'pes', 'alergiasVerificadasEn'];

const APROBACION = {
  responsableClinico: 'Dra. Responsable Clínica (prueba)',
  responsableLegal: 'Lic. Responsable Legal (prueba)',
  fecha: '2026-10-01',
  referencia: 'ACTA-PRUEBA-001',
};

/** Simula la aprobación SIN tocar el catálogo real: sólo para ejercitar las reglas. */
function aprobado(especialidad: EspecialidadKey): PerfilEspecialidad {
  const entrada = CATALOGO_NOTAS_V1.especialidades[especialidad]!;
  return aplicarCatalogo(PERFILES[especialidad], { ...entrada, estado: 'aprobado', aprobacion: APROBACION });
}

function nota(over: Partial<NotaEvolucionContent>): NotaEvolucionContent {
  return {
    ...EMPTY_NOTA_EVOLUCION,
    padecimientoActual: '<p>Consulta</p>',
    exploracionFisica: { signosVitales: { ...EMPTY_NOTA_EVOLUCION.exploracionFisica.signosVitales, ta: '120/80' } },
    diagnosticos: [{ cie10: 'Z00.0', descripcion: 'Examen general' }],
    planTerapeutico: '<p>Plan</p>',
    plantillaVersion: 'v1',
    ...over,
  };
}

const errores = (c: NotaEvolucionContent, perfil: PerfilEspecialidad) =>
  validarCierre(c, evaluarEsquema(c, perfil), perfil);
const rutas = (c: NotaEvolucionContent, perfil: PerfilEspecialidad) => errores(c, perfil).map((e) => e.ruta);

describe('Catálogo de notas v1 (borrador)', () => {
  describe('cada regla está completa y es revisable', () => {
    for (const especialidad of PILOTO) {
      const entrada = CATALOGO_NOTAS_V1.especialidades[especialidad]!;
      const perfil = aprobado(especialidad);
      const campos = new Set(perfil.camposExtra.map((c) => c.key));
      const bloques = new Set((perfil.bloques ?? []).map((b) => b.bloque));
      const motivos = new Set(entrada.motivosConsulta.map((m) => m.id));

      it(`${especialidad}: id estable, escenario, objetivo, requisito, estados, motivo y ayuda`, () => {
        expect(entrada.reglas.length).toBeGreaterThan(0);
        for (const r of entrada.reglas) {
          expect(r.id).toMatch(new RegExp(`^v1\\.${especialidad}\\.[a-z_]+\\.[a-z_]+$`));
          expect(r.escenario.trim()).not.toBe('');
          expect(r.ayuda.trim()).not.toBe('');
          expect(['requerido', 'opcional']).toContain(r.requisito);
          expect(typeof r.requiereMotivo).toBe('boolean');
          r.estadosPermitidos.forEach((e) => expect(ESTADOS_NO_CAPTURADO).toContain(e));
          // Exigir motivo sin ofrecer ningún estado sería una regla imposible de cumplir así.
          if (r.requiereMotivo) expect(r.estadosPermitidos.length).toBeGreaterThan(0);
          if (r.objetivo.tipo === 'campo') expect(campos).toContain(r.objetivo.key);
          else expect(bloques).toContain(r.objetivo.bloque);
          (r.cuando.motivos ?? []).forEach((m) => expect(motivos).toContain(m));
        }
      });

      it(`${especialidad}: ids únicos, bloques conocidos y sin claves repetidas`, () => {
        const ids = entrada.reglas.map((r) => r.id);
        expect(new Set(ids).size).toBe(ids.length);
        entrada.bloques.forEach((b) => expect(BLOQUES_VALIDOS).toContain(b.bloque));
        const claves = perfil.camposExtra.map((c) => c.key);
        expect(new Set(claves).size).toBe(claves.length);
        // Lo retirado existía en el perfil base: un typo aquí dejaría el campo viejo vivo.
        entrada.camposRetirados.forEach((k) => expect(PERFILES[especialidad].camposExtra.map((c) => c.key)).toContain(k));
      });
    }

    it('las reglas no se apoyan en inferencias: sólo tipo, contexto, motivo de catálogo o CIE-10', () => {
      for (const especialidad of PILOTO) {
        for (const r of CATALOGO_NOTAS_V1.especialidades[especialidad]!.reglas) {
          expect(Object.keys(r.cuando).every((k) => ['tiposNota', 'contextosNota', 'motivos', 'diagnosticosCie10'].includes(k))).toBe(true);
        }
      }
    });
  });

  describe('sólo se expone lo aprobado', () => {
    it('las tres especialidades siguen en borrador, sin aprobación', () => {
      for (const especialidad of PILOTO) {
        const entrada = CATALOGO_NOTAS_V1.especialidades[especialidad]!;
        expect(entrada.estado).toBe('borrador');
        expect(entrada.aprobacion).toBeNull();
        expect(catalogoActivoDe(especialidad)).toBeUndefined();
      }
    });

    it('un perfil v1 en borrador es idéntico al perfil base: ni reglas, ni bloques, ni motivos', () => {
      for (const especialidad of PILOTO) {
        expect(perfilDe(especialidad, 'v1')).toBe(PERFILES[especialidad]);
      }
    });

    it('una nota legacy o sin plantilla recibe siempre el perfil base', () => {
      for (const especialidad of PILOTO) {
        expect(perfilDe(especialidad)).toBe(PERFILES[especialidad]);
        expect(perfilDe(especialidad, 'legacy-v0')).toBe(PERFILES[especialidad]);
      }
    });

    it('"aprobado" sin aprobación completa no cuenta', () => {
      const base = CATALOGO_NOTAS_V1.especialidades.cardiologia!;
      const casos: CatalogoEspecialidadV1[] = [
        { ...base, estado: 'aprobado', aprobacion: null },
        { ...base, estado: 'aprobado', aprobacion: { ...APROBACION, responsableLegal: ' ' } },
        { ...base, estado: 'aprobado', aprobacion: { ...APROBACION, referencia: '' } },
        { ...base, estado: 'aprobado', aprobacion: { ...APROBACION, fecha: 'pronto' } },
        { ...base, estado: 'borrador', aprobacion: APROBACION },
      ];
      casos.forEach((c) => expect(catalogoAprobado(c)).toBe(false));
      expect(catalogoAprobado({ ...base, estado: 'aprobado', aprobacion: APROBACION })).toBe(true);
    });

    it('un catálogo aprobado sí se activa (sobre una copia, no el real)', () => {
      const copia: CatalogoNotas = {
        ...CATALOGO_NOTAS_V1,
        especialidades: {
          cardiologia: { ...CATALOGO_NOTAS_V1.especialidades.cardiologia!, estado: 'aprobado', aprobacion: APROBACION },
        },
      };
      expect(catalogoActivoDe('cardiologia', copia)).toBeDefined();
      expect(catalogoActivoDe('nutricion', copia)).toBeUndefined();
    });
  });

  describe('ningún script enciende un borrador', () => {
    it('rechaza las tres especialidades mientras estén en borrador', () => {
      for (const especialidad of PILOTO) {
        expect(motivoParaNoActivar(especialidad)).toMatch(/borrador.*sin aprobación/);
      }
    });

    it('rechaza especialidades sin catálogo y claves inventadas', () => {
      expect(motivoParaNoActivar('odontologia')).toMatch(/no tiene catálogo/);
      expect(motivoParaNoActivar('astrologia')).toMatch(/desconocida/);
    });

    it('sólo con aprobación completa deja de rechazar', () => {
      const conAprobacion: CatalogoNotas = {
        ...CATALOGO_NOTAS_V1,
        especialidades: {
          ...CATALOGO_NOTAS_V1.especialidades,
          nutricion: { ...CATALOGO_NOTAS_V1.especialidades.nutricion!, estado: 'aprobado', aprobacion: APROBACION },
        },
      };
      expect(motivoParaNoActivar('nutricion', conAprobacion)).toBeNull();
      expect(motivoParaNoActivar('cardiologia', conAprobacion)).not.toBeNull();
    });
  });

  describe('los borradores no cambian una nota existente', () => {
    const legacy = (especialidad: EspecialidadKey): NotaEvolucionContent => ({
      ...EMPTY_HISTORIA_CLINICA,
      especialidad,
    });
    const v1 = (especialidad: EspecialidadKey): NotaEvolucionContent =>
      nota({ especialidad, tipoNota: 'historia_clinica', contextoNota: 'inicial_especialidad' });

    it('el esquema de una nota legacy y de una v1 es el mismo que con el perfil base', () => {
      for (const especialidad of PILOTO) {
        for (const c of [legacy(especialidad), v1(especialidad)]) {
          expect(evaluarEsquema(c)).toEqual(evaluarEsquema(c, PERFILES[especialidad]));
          expect(validarCierre(c, evaluarEsquema(c))).toEqual(errores(c, PERFILES[especialidad]));
        }
      }
    });

    it('ningún campo, bloque o regla del borrador aparece en el esquema', () => {
      for (const especialidad of PILOTO) {
        const entrada = CATALOGO_NOTAS_V1.especialidades[especialidad]!;
        const esquema = evaluarEsquema(v1(especialidad));
        const rutasEsquema = esquema.campos.map((c) => c.ruta);
        entrada.camposNuevos.forEach((c) => expect(rutasEsquema).not.toContain(`extension.${c.key}`));
        expect(rutasEsquema.some((r) => r.startsWith('bloques.'))).toBe(false);
        const idsBorrador = new Set(entrada.reglas.map((r) => r.id));
        esquema.campos.forEach((c) => expect(idsBorrador.has(c.reglaId ?? '')).toBe(false));
      }
    });

    it('al firmar se congela el esquema del perfil vigente, sin reglas del borrador', () => {
      const c = { ...v1('cardiologia'), verificacionAntecedentes: { estado: 'verificados_sin_cambios' as const } };
      const note = ClinicalNote.fromState({
        id: 'n1',
        clinicalRecordId: 'r1',
        appointmentId: 'a1',
        doctorId: 'd1',
        tipoNota: 'historia_clinica',
        estatus: 'borrador',
        contenido: c,
        cerradoEn: null,
        createdAt: new Date('2026-09-13T09:00:00Z'),
      });
      note.close(c, { medicoNombre: 'Dr. X', cedula: '123', fecha: '2026-09-13' }, new Date(), 'cardiologia');

      const congelado = note.contenido.esquemaAlCierre!;
      expect(congelado).toEqual(evaluarEsquema(c, PERFILES.cardiologia));
      // Si el borrador se aprobara después, pediría más; lo firmado no cambia
      // porque la lectura usa `esquemaAlCierre` (ver GetConsultationNoteUseCase).
      expect(evaluarEsquema(c, aprobado('cardiologia'))).not.toEqual(congelado);
    });

    it('no acepta motivos de un catálogo que no está activo', () => {
      const note = ClinicalNote.fromState({
        id: 'n1',
        clinicalRecordId: 'r1',
        appointmentId: 'a1',
        doctorId: 'd1',
        tipoNota: 'nota_evolucion',
        estatus: 'borrador',
        contenido: nota({ especialidad: 'cardiologia', contextoNota: 'seguimiento' }),
        cerradoEn: null,
        createdAt: new Date('2026-09-13T09:00:00Z'),
      });
      expect(() => note.saveDraft(nota({ motivoConsulta: 'dolor_toracico' }))).toThrow(EstructuraNotaInvalidaError);
    });
  });

  // Mecánica de cada escenario con la aprobación SIMULADA. Documenta lo que el
  // borrador haría; no es evidencia clínica ni lo activa.
  describe('escenarios del borrador (aprobación simulada)', () => {
    describe('medicina general', () => {
      const perfil = aprobado('general');
      const base = (over: Partial<NotaEvolucionContent> = {}) =>
        nota({ especialidad: 'general', contextoNota: 'seguimiento', ...over });

      it('sustituye el texto libre por bloques', () => {
        const claves = perfil.camposExtra.map((c) => c.key);
        expect(claves).not.toContain('gen_conciliacion_medicamentos');
        expect(claves).toContain('gen_revision_sistemas');
        expect((perfil.bloques ?? []).map((b) => b.bloque)).toEqual(
          expect.arrayContaining(['problemas', 'medicamentos', 'seguimiento']),
        );
      });

      it('no cierra con problemas y seguimiento en blanco', () => {
        expect(rutas(base(), perfil)).toEqual(['bloques.problemas', 'bloques.seguimiento']);
      });

      it('sí cierra con "sin problemas activos" y "seguimiento no requerido" justificado', () => {
        const c = base({
          bloques: {
            problemas: { items: [], declaracion: 'sin_problemas_activos' },
            seguimiento: { declaracion: 'seguimiento_no_requerido', motivo: 'Resuelto, alta' },
          },
        });
        expect(rutas(c, perfil)).toEqual([]);
        expect(
          rutas({ ...c, bloques: { ...c.bloques, seguimiento: { declaracion: 'seguimiento_no_requerido' } } }, perfil),
        ).toEqual(['bloques.seguimiento']);
      });

      it('la conciliación sólo se exige en la historia general', () => {
        const general = base({ contextoNota: 'general', tipoNota: 'historia_clinica' });
        expect(evaluarEsquema(general, perfil).campos.find((x) => x.ruta === 'bloques.medicamentos')).toMatchObject({
          requisito: 'requerido',
          reglaId: 'v1.general.primera_valoracion.medicamentos',
        });
        expect(evaluarEsquema(base(), perfil).campos.find((x) => x.ruta === 'bloques.medicamentos')?.requisito).toBe(
          'opcional',
        );
      });
    });

    describe('cardiología', () => {
      const perfil = aprobado('cardiologia');

      it('primera valoración: antecedentes CV, riesgo, síntomas, exploración, medicamentos y alergias', () => {
        const c = nota({ especialidad: 'cardiologia', tipoNota: 'historia_clinica', contextoNota: 'inicial_especialidad', verificacionAntecedentes: { estado: 'verificados_sin_cambios' } });
        // En el orden de los campos del perfil, que es el orden en pantalla.
        expect(rutas(c, perfil)).toEqual([
          'extension.car_sintomas',
          'extension.car_exploracion',
          'extension.car_riesgo',
          'extension.car_antecedente_cv',
          'bloques.medicamentos',
          'bloques.alergiasVerificadasEn',
        ]);
        const campo = evaluarEsquema(c, perfil).campos.find((x) => x.ruta === 'extension.car_antecedente_cv');
        expect(campo).toMatchObject({ estadosPermitidos: ['no_valorado'], requiereMotivo: true });
        expect(campo?.ayuda).toMatch(/antecedente cardiovascular/);
      });

      it('visita preventiva: no exige FEVI ni ECG, sí el registro de riesgo o su no valoración con motivo', () => {
        const c = nota({ especialidad: 'cardiologia', contextoNota: 'seguimiento', motivoConsulta: 'prevencion_riesgo_cv' });
        const pedidos = rutas(c, perfil);
        expect(pedidos).toEqual(['bloques.riesgoCv']);
        expect(evaluarEsquema(c, perfil).campos.map((x) => x.ruta)).not.toContain('extension.car_ecg');

        const noValorado = { ...c, noCapturado: { 'bloques.riesgoCv': { estado: 'no_valorado' as const } } };
        expect(errores(noValorado, perfil)).toEqual([
          { codigo: 'MOTIVO_REQUERIDO', ruta: 'bloques.riesgoCv', reglaId: 'v1.cardiologia.prevencion.riesgo_cv' },
        ]);
        expect(
          rutas({ ...c, noCapturado: { 'bloques.riesgoCv': { estado: 'no_valorado', motivo: 'Sin perfil de lípidos' } } }, perfil),
        ).toEqual([]);
      });

      it('insuficiencia cardiaca (I50): NYHA, congestión, FEVI o motivo, tratamiento y seguimiento', () => {
        const c = nota({
          especialidad: 'cardiologia',
          contextoNota: 'seguimiento',
          diagnosticos: [{ cie10: 'I50.0', descripcion: 'Insuficiencia cardiaca congestiva' }],
          noCapturado: { 'extension.car_fraccion_eyeccion': { estado: 'no_valorado', motivo: 'Ecocardiograma pendiente' } },
        });
        expect(rutas(c, perfil)).toEqual([
          'extension.car_clase_funcional',
          'extension.car_congestion',
          'bloques.medicamentos',
          'bloques.seguimiento',
        ]);
      });

      it('dolor torácico: pide documentar la acción tomada, no decide la urgencia', () => {
        const c = nota({ especialidad: 'cardiologia', contextoNota: 'seguimiento', motivoConsulta: 'dolor_toracico' });
        expect(rutas(c, perfil)).toEqual(['extension.car_triage_accion', 'bloques.seguimiento']);
      });
    });

    describe('nutrición', () => {
      const perfil = aprobado('nutricion');

      it('primera valoración: fuentes, PES, prescripción y monitoreo', () => {
        const c = nota({ especialidad: 'nutricion', tipoNota: 'historia_clinica', contextoNota: 'inicial_especialidad', verificacionAntecedentes: { estado: 'verificados_sin_cambios' } });
        expect(rutas(c, perfil)).toEqual([
          'extension.nut_prescripcion',
          'extension.nut_monitoreo_evaluacion',
          'extension.nut_fuentes_evaluacion',
          'bloques.pes',
        ]);
      });

      it('ADIME de punta a punta cierra; "no procede" exige motivo', () => {
        const completa = nota({
          especialidad: 'nutricion',
          tipoNota: 'historia_clinica',
          contextoNota: 'inicial_especialidad',
          verificacionAntecedentes: { estado: 'verificados_sin_cambios' },
          extension: {
            nut_fuentes_evaluacion: 'Antropometría,Ingesta',
            nut_prescripcion: '<p>1800 kcal</p>',
            nut_monitoreo_evaluacion: '<p>Peso en 4 semanas</p>',
          },
          bloques: { pes: [{ problema: 'Ingesta energética excesiva', etiologia: 'Horarios', signosSintomas: 'IMC 31' }] },
        });
        expect(rutas(completa, perfil)).toEqual([]);

        const sinPes = { ...completa, bloques: {}, noCapturado: { 'bloques.pes': { estado: 'no_aplica' as const } } };
        expect(errores(sinPes, perfil).map((e) => e.codigo)).toEqual(['MOTIVO_REQUERIDO']);
      });

      it('un seguimiento nutricional no exige lo de la primera valoración', () => {
        expect(rutas(nota({ especialidad: 'nutricion', contextoNota: 'seguimiento' }), perfil)).toEqual([]);
      });
    });
  });
});
