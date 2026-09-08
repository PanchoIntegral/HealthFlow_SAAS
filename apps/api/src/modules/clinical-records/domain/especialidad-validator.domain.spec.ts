import {
  ESPECIALIDADES,
  PERFILES,
  mapaCorporalValido,
  resumirMapaCorporal,
  type MapaCorporal,
  type NotaEvolucionContent,
} from '@healthflow/shared-types';
import { EspecialidadValidator } from './especialidad-validator';

/** Nota que cumple la base NOM-004: cualquier faltante viene de la especialidad. */
function notaBaseCompleta(over: Partial<NotaEvolucionContent> = {}): NotaEvolucionContent {
  return {
    tipoNota: 'nota_evolucion',
    padecimientoActual: '<p>Acude por control</p>',
    exploracionFisica: {
      signosVitales: { ta: '120/80', fc: null, fr: null, temp: null, spo2: null, peso: null, talla: null },
      hallazgos: '',
    },
    diagnosticos: [{ cie10: 'K02.1', descripcion: 'Caries de la dentina' }],
    planTerapeutico: '<p>Amoxicilina 500 mg VO c/8h por 7 días</p>',
    ...over,
  };
}

function mapaCorporalCompleto(over: Partial<MapaCorporal['marcas'][number]> = {}): MapaCorporal {
  return {
    marcas: [
      {
        id: 'herida-1',
        vista: 'anterior',
        x: 235,
        y: 610,
        tipo: 'herida',
        descripcion: 'Maléolo medial derecho',
        ...over,
      },
    ],
  };
}

describe('EspecialidadValidator', () => {
  describe('catálogo ampliado de notas', () => {
    const excluidas = new Set(['odontologia', 'podologia']);

    it('agrega los complementos médicos a todas salvo odontología y podiatría', () => {
      const medicas = ESPECIALIDADES.filter((key) => !excluidas.has(key));

      expect(medicas).toHaveLength(ESPECIALIDADES.length - excluidas.size);
      for (const key of medicas) {
        const claves = PERFILES[key].camposExtra.map((campo) => campo.key);
        expect(claves).toEqual(
          expect.arrayContaining([
            'com_resultados_estudios',
            'com_pronostico',
            'com_seguimiento',
          ]),
        );
      }
    });

    it('la clínica de heridas exige identificar la localización anatómica', () => {
      const nota = notaBaseCompleta({ especialidad: 'heridas_estomas' });

      expect(EspecialidadValidator.validar(nota)).toEqual([
        'extension.her_localizacion',
        'mapaCorporal',
      ]);
      nota.extension = { her_localizacion: 'Maléolo medial derecho' };
      nota.mapaCorporal = mapaCorporalCompleto();
      expect(EspecialidadValidator.validar(nota)).toEqual([]);
    });

    it('rechaza mapas vacíos, coordenadas fuera del cuerpo e ids duplicados', () => {
      expect(mapaCorporalValido({ marcas: [] })).toBe(false);
      expect(mapaCorporalValido({} as MapaCorporal)).toBe(false);
      expect(mapaCorporalValido(mapaCorporalCompleto({ x: 1001 }))).toBe(false);
      const repetida = mapaCorporalCompleto().marcas[0]!;
      expect(mapaCorporalValido({ marcas: [repetida, { ...repetida }] })).toBe(false);
    });

    it('produce un resumen clínico legible sin depender del dibujo', () => {
      expect(resumirMapaCorporal(mapaCorporalCompleto())).toEqual([
        '1. Herida · Vista anterior · Maléolo medial derecho',
      ]);
    });

    it('rechaza EVA y porcentajes fuera de sus límites clínicos', () => {
      const nota = notaBaseCompleta({
        especialidad: 'heridas_estomas',
        extension: {
          her_localizacion: 'Región sacra',
          her_dolor_eva: 11,
          her_tejido_granulacion: 101,
        },
        mapaCorporal: mapaCorporalCompleto(),
      });

      expect(EspecialidadValidator.validar(nota)).toEqual([
        'extension.her_dolor_eva',
        'extension.her_tejido_granulacion',
      ]);
    });

    it('mantiene odontología y podiatría fuera del bloque común', () => {
      for (const key of ['odontologia', 'podologia'] as const) {
        expect(PERFILES[key].camposExtra.some((campo) => campo.key.startsWith('com_'))).toBe(false);
      }
    });

    it('no repite claves dentro de ningún perfil', () => {
      for (const perfil of Object.values(PERFILES)) {
        const claves = perfil.camposExtra.map((campo) => campo.key);
        expect(new Set(claves).size).toBe(claves.length);
      }
    });
  });

  describe('la base NOM-004 aplica a todos', () => {
    it('sigue exigiendo los cuatro campos de siempre en medicina general', () => {
      const vacia: NotaEvolucionContent = {
        tipoNota: 'nota_evolucion',
        padecimientoActual: '',
        exploracionFisica: {
          signosVitales: { ta: null, fc: null, fr: null, temp: null, spo2: null, peso: null, talla: null },
        },
        diagnosticos: [],
        planTerapeutico: '',
        especialidad: 'general',
      };
      expect(EspecialidadValidator.validar(vacia)).toEqual([
        'padecimientoActual',
        'signosVitales.ta',
        'diagnosticos',
        'planTerapeutico',
      ]);
    });

    it('deja cerrar una nota general completa, sin pedir nada extra', () => {
      expect(EspecialidadValidator.validar(notaBaseCompleta({ especialidad: 'general' }))).toEqual([]);
    });
  });

  describe('campos obligatorios de la especialidad', () => {
    it('exige los campos dentales que pide la NOM-013 aunque la base esté completa', () => {
      const nota = notaBaseCompleta({ especialidad: 'odontologia' });
      expect(EspecialidadValidator.validar(nota)).toEqual([
        'extension.odo_piezas_tratadas',
        'extension.odo_tratamiento_sesion',
      ]);
    });

    it('cierra cuando el dentista llena sus campos', () => {
      const nota = notaBaseCompleta({
        especialidad: 'odontologia',
        extension: {
          odo_piezas_tratadas: '16, 26',
          odo_tratamiento_sesion: '<p>Obturación con resina</p>',
        },
      });
      expect(EspecialidadValidator.validar(nota)).toEqual([]);
    });

    it('acumula faltantes de la base y de la especialidad a la vez', () => {
      const nota = notaBaseCompleta({ especialidad: 'odontologia', planTerapeutico: '' });
      expect(EspecialidadValidator.validar(nota)).toEqual([
        'planTerapeutico',
        'extension.odo_piezas_tratadas',
        'extension.odo_tratamiento_sesion',
      ]);
    });
  });

  describe('qué cuenta como campo lleno', () => {
    it('trata el HTML vacío de TipTap como no llenado', () => {
      const nota = notaBaseCompleta({
        especialidad: 'odontologia',
        extension: { odo_piezas_tratadas: '16', odo_tratamiento_sesion: '<p></p>' },
      });
      expect(EspecialidadValidator.validar(nota)).toContain('extension.odo_tratamiento_sesion');
    });

    it('acepta el cero como valor válido', () => {
      // Un CPOD de 0 cariados es un hallazgo real, no un campo en blanco.
      const nota = notaBaseCompleta({
        especialidad: 'oftalmologia',
        extension: { oft_agudeza_od: '20/20', oft_agudeza_oi: 0 },
      });
      expect(EspecialidadValidator.validar(nota)).toEqual([]);
    });
  });

  describe('omisión declarada de signos vitales', () => {
    /** Nota dental completa salvo la tensión arterial. */
    const sinTension = (over: Partial<NotaEvolucionContent> = {}): NotaEvolucionContent =>
      notaBaseCompleta({
        especialidad: 'odontologia',
        exploracionFisica: {
          signosVitales: { ta: null, fc: '72', fr: null, temp: null, spo2: null, peso: null, talla: null },
        },
        extension: {
          odo_piezas_tratadas: '16',
          odo_tratamiento_sesion: '<p>Revisión</p>',
        },
        ...over,
      });

    it('exige la tensión arterial mientras no se declare la omisión', () => {
      expect(EspecialidadValidator.validar(sinTension())).toEqual(['signosVitales.ta']);
    });

    it('la libera cuando el dentista marca explícitamente que no se tomaron', () => {
      expect(EspecialidadValidator.validar(sinTension({ signosVitalesOmitidos: true }))).toEqual([]);
    });

    it('NO la libera en una especialidad que no tiene el permiso', () => {
      // Aunque venga la bandera puesta: medicina general no puede saltarse
      // NOM-004 por mucho que el cliente mande el campo.
      const nota = notaBaseCompleta({
        especialidad: 'general',
        exploracionFisica: {
          signosVitales: { ta: null, fc: null, fr: null, temp: null, spo2: null, peso: null, talla: null },
        },
        signosVitalesOmitidos: true,
      });
      expect(EspecialidadValidator.validar(nota)).toEqual(['signosVitales.ta']);
    });

    it('no dispensa ningún otro campo obligatorio', () => {
      const nota = sinTension({
        signosVitalesOmitidos: true,
        planTerapeutico: '',
        extension: { odo_tratamiento_sesion: '<p>Revisión</p>' },
      });
      expect(EspecialidadValidator.validar(nota)).toEqual([
        'planTerapeutico',
        'extension.odo_piezas_tratadas',
      ]);
    });
  });

  describe('historia clínica inicial', () => {
    it('exige los 3 antecedentes además de la base NOM-004', () => {
      const nota = notaBaseCompleta({ tipoNota: 'historia_clinica', especialidad: 'general' });
      expect(EspecialidadValidator.validar(nota)).toEqual([
        'antecedentesHeredofamiliares',
        'antecedentesPersonalesPatologicos',
        'antecedentesPersonalesNoPatologicos',
      ]);
    });

    it('cierra cuando los 3 antecedentes están llenos', () => {
      const nota = notaBaseCompleta({
        tipoNota: 'historia_clinica',
        especialidad: 'general',
        antecedentesHeredofamiliares: 'Madre con DM2',
        antecedentesPersonalesPatologicos: 'Sin antecedentes de relevancia',
        antecedentesPersonalesNoPatologicos: 'Niega tabaquismo. Esquema de vacunación completo.',
      });
      expect(EspecialidadValidator.validar(nota)).toEqual([]);
    });

    it('NO exige antecedentes en una nota de evolución normal', () => {
      const nota = notaBaseCompleta({ tipoNota: 'nota_evolucion', especialidad: 'general' });
      expect(EspecialidadValidator.validar(nota)).toEqual([]);
    });
  });

  describe('podología', () => {
    it('exige el riesgo de pie diabético para cerrar', () => {
      const nota = notaBaseCompleta({ especialidad: 'podologia' });
      expect(EspecialidadValidator.validar(nota)).toEqual([
        'extension.pod_riesgo_pie_diabetico',
      ]);
    });

    it('cierra cuando el cribado está concluido', () => {
      const nota = notaBaseCompleta({
        especialidad: 'podologia',
        extension: { pod_riesgo_pie_diabetico: 'Moderado' },
      });
      expect(EspecialidadValidator.validar(nota)).toEqual([]);
    });

    it('el podograma NO es obligatorio: un pie sano son cero marcas', () => {
      const nota = notaBaseCompleta({
        especialidad: 'podologia',
        extension: { pod_riesgo_pie_diabetico: 'Bajo' },
        podograma: { marcas: [] },
      });
      expect(EspecialidadValidator.validar(nota)).toEqual([]);
    });
  });

  describe('campos de solo primera visita', () => {
    // El riesgo real de `soloHistoriaClinica` es exigir un campo que la
    // pantalla no muestra: la nota quedaría imposible de cerrar y el médico no
    // vería dónde está el problema. Estas pruebas cubren justo eso.
    it('un campo oculto en la subsecuente no puede bloquear el cierre', () => {
      const nota = notaBaseCompleta({
        tipoNota: 'nota_evolucion',
        especialidad: 'podologia',
        extension: { pod_riesgo_pie_diabetico: 'Bajo' },
      });
      const faltantes = EspecialidadValidator.validar(nota);
      expect(faltantes.some((c) => c.startsWith('extension.pod_ocupacion'))).toBe(false);
      expect(faltantes).toEqual([]);
    });

    it('los campos de primera visita no son obligatorios ni en la historia clínica', () => {
      // Ninguno de los campos de identificación de podología lleva
      // `obligatorio`: se preguntan, no se imponen. Lo único que bloquea el
      // cierre es el cribado.
      const nota = notaBaseCompleta({
        tipoNota: 'historia_clinica',
        especialidad: 'podologia',
        antecedentesHeredofamiliares: 'Padre con DM2',
        antecedentesPersonalesPatologicos: 'DM2 de 10 años',
        antecedentesPersonalesNoPatologicos: 'Camina descalzo en alberca',
        extension: { pod_riesgo_pie_diabetico: 'Alto' },
      });
      expect(EspecialidadValidator.validar(nota)).toEqual([]);
    });
  });

  describe('degradado seguro', () => {
    // Estas son las que importan de verdad: ninguna configuración puede dejar
    // a un médico sin poder firmar una nota que ya empezó.
    it('trata una especialidad desconocida como general, sin lanzar', () => {
      const nota = notaBaseCompleta({
        especialidad: 'especialidad_que_ya_no_existe' as never,
      });
      expect(EspecialidadValidator.validar(nota)).toEqual([]);
    });

    it('trata una nota sin especialidad (anterior a esta función) como general', () => {
      const nota = notaBaseCompleta();
      delete nota.especialidad;
      expect(EspecialidadValidator.validar(nota)).toEqual([]);
    });

    it('no revienta si falta el objeto extension por completo', () => {
      const nota = notaBaseCompleta({ especialidad: 'odontologia' });
      delete nota.extension;
      expect(() => EspecialidadValidator.validar(nota)).not.toThrow();
    });
  });
});
