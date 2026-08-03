import type { NotaEvolucionContent } from '@healthflow/shared-types';
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

describe('EspecialidadValidator', () => {
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
