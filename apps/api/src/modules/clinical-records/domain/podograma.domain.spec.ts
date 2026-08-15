import {
  HALLAZGOS_PODOLOGICOS,
  PERFILES,
  ZONAS_PIE,
  camposDeNota,
  hallazgoAplicaEnZona,
  hallazgoPodologicoPorKey,
  resumirPodograma,
  zonaPiePorKey,
} from '@healthflow/shared-types';

describe('Podograma', () => {
  describe('integridad del catálogo', () => {
    // Las claves quedan escritas en el jsonb de notas FIRMADAS, que por
    // NOM-004 son inmutables. Una clave duplicada haría que dos hallazgos
    // distintos se leyeran como el mismo al reabrir un expediente viejo.
    it('no hay claves de hallazgo repetidas', () => {
      const keys = HALLAZGOS_PODOLOGICOS.map((h) => h.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('no hay claves de zona repetidas', () => {
      const keys = ZONAS_PIE.map((z) => z.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('toda zona ungueal vive en la vista dorsal', () => {
      // Las uñas no se ven por la planta. Una zona ungueal marcada como
      // plantar sería inalcanzable: el hallazgo ungueal no podría marcarse
      // nunca porque la vista donde vive no lo admite.
      const ungueales = ZONAS_PIE.filter((z) => z.ungueal);
      expect(ungueales.length).toBeGreaterThan(0);
      expect(ungueales.every((z) => z.vista === 'dorsal')).toBe(true);
    });

    it('todo hallazgo ungueal tiene al menos una zona donde marcarse', () => {
      const ungueales = HALLAZGOS_PODOLOGICOS.filter((h) => h.soloUngueal);
      for (const h of ungueales) {
        const cabe = ZONAS_PIE.some((z) => hallazgoAplicaEnZona(h.key, z.key));
        expect(cabe).toBe(true);
      }
    });

    it('las elipses caben en el lienzo de 100×250', () => {
      // Una zona fuera del lienzo se recorta contra la silueta y queda sin
      // área que tocar: existiría en el catálogo pero no en la pantalla.
      for (const z of ZONAS_PIE) {
        expect(z.cx - z.rx).toBeGreaterThanOrEqual(0);
        expect(z.cx + z.rx).toBeLessThanOrEqual(100);
        expect(z.cy - z.ry).toBeGreaterThanOrEqual(0);
        expect(z.cy + z.ry).toBeLessThanOrEqual(250);
      }
    });
  });

  describe('hallazgoAplicaEnZona', () => {
    it('permite un hallazgo ungueal sobre una uña', () => {
      expect(hallazgoAplicaEnZona('onicomicosis', 'd_una_1')).toBe(true);
    });

    it('rechaza una onicomicosis en el talón', () => {
      // No es un dato raro: es imposible. El talón no tiene uña.
      expect(hallazgoAplicaEnZona('onicomicosis', 'p_talon')).toBe(false);
    });

    it('permite un hallazgo cutáneo en cualquier zona, uñas incluidas', () => {
      expect(hallazgoAplicaEnZona('hiperqueratosis', 'p_talon')).toBe(true);
      expect(hallazgoAplicaEnZona('hiperqueratosis', 'd_una_1')).toBe(true);
    });

    it('rechaza claves desconocidas en vez de lanzar', () => {
      // Corre sobre datos que pueden venir de una nota vieja o de la IA.
      expect(hallazgoAplicaEnZona('no_existe', 'p_talon')).toBe(false);
      expect(hallazgoAplicaEnZona('hiperqueratosis', 'no_existe')).toBe(false);
    });
  });

  describe('resumirPodograma', () => {
    it('agrupa por hallazgo y nombra pie y zona', () => {
      const resumen = resumirPodograma({
        marcas: [
          { pie: 'derecho', zona: 'p_talon', hallazgo: 'hiperqueratosis' },
          { pie: 'izquierdo', zona: 'p_talon', hallazgo: 'hiperqueratosis' },
          { pie: 'derecho', zona: 'd_una_1', hallazgo: 'onicomicosis' },
        ],
      });

      expect(resumen).toHaveLength(2);
      expect(resumen[0]).toContain('Hiperqueratosis');
      expect(resumen[0]).toContain('derecho');
      expect(resumen[0]).toContain('izquierdo');
      expect(resumen[1]).toContain('Onicomicosis');
    });

    it('un podograma vacío no produce líneas', () => {
      expect(resumirPodograma({ marcas: [] })).toEqual([]);
    });

    it('no revienta con una zona retirada del catálogo', () => {
      // Una nota firmada hace un año puede citar una zona que ya no existe.
      // Debe seguir leyéndose: el expediente es inmutable, el catálogo no.
      const resumen = resumirPodograma({
        marcas: [{ pie: 'derecho', zona: 'zona_retirada', hallazgo: 'hallazgo_retirado' }],
      });
      expect(resumen).toHaveLength(1);
      expect(resumen[0]).toContain('zona_retirada');
    });
  });

  describe('camposDeNota', () => {
    const campos = PERFILES.podologia.camposExtra;

    it('la historia clínica muestra todos los campos', () => {
      expect(camposDeNota(campos, 'historia_clinica')).toHaveLength(campos.length);
    });

    it('la nota de evolución oculta los de primera visita', () => {
      const visibles = camposDeNota(campos, 'nota_evolucion');
      expect(visibles.length).toBeLessThan(campos.length);
      expect(visibles.some((c) => c.key === 'pod_ocupacion_actual')).toBe(false);
      // El cribado se repite en CADA consulta: es seguimiento, no ficha.
      expect(visibles.some((c) => c.key === 'pod_riesgo_pie_diabetico')).toBe(true);
      expect(visibles.some((c) => c.key === 'pod_monofilamento_izq')).toBe(true);
    });

    it('ningún campo obligatorio queda oculto en la subsecuente', () => {
      // Es la invariante que evita el peor bug posible: una nota que no se
      // puede cerrar porque exige un campo que la pantalla no muestra.
      for (const perfil of Object.values(PERFILES)) {
        const ocultos = perfil.camposExtra.filter(
          (c) => c.soloHistoriaClinica && c.obligatorio,
        );
        expect(ocultos).toEqual([]);
      }
    });
  });

  describe('el perfil de podología', () => {
    it('todo campo por pie viene en par izquierdo/derecho', () => {
      // La asimetría es el hallazgo en pie diabético: un lado sin su pareja
      // sería un dato que no se puede interpretar.
      const claves = PERFILES.podologia.camposExtra.map((c) => c.key);
      for (const key of claves.filter((k) => k.endsWith('_izq'))) {
        expect(claves).toContain(key.replace(/_izq$/, '_der'));
      }
      for (const key of claves.filter((k) => k.endsWith('_der'))) {
        expect(claves).toContain(key.replace(/_der$/, '_izq'));
      }
    });

    it('el checklist de antecedentes patológicos no tiene opciones repetidas', () => {
      const campo = PERFILES.podologia.camposExtra.find(
        (c) => c.key === 'pod_antecedentes_patologicos',
      )!;
      expect(campo.tipo).toBe('multi-seleccion');
      const opciones = campo.opciones ?? [];
      expect(new Set(opciones).size).toBe(opciones.length);
      expect(opciones.length).toBeGreaterThanOrEqual(20); // el checklist de la hoja 1
    });

    it('ningún campo del checklist de antecedentes es obligatorio', () => {
      // Un paciente sano no marca ninguna casilla; exigirlo forzaría a
      // "inventar" un antecedente solo para poder cerrar la nota.
      const campo = PERFILES.podologia.camposExtra.find(
        (c) => c.key === 'pod_antecedentes_patologicos',
      )!;
      expect(campo.obligatorio).toBeFalsy();
    });

    it('los catálogos se resuelven por clave', () => {
      expect(hallazgoPodologicoPorKey('ulcera')?.label).toBe('Úlcera');
      expect(zonaPiePorKey('p_talon')?.label).toContain('Talón');
      expect(hallazgoPodologicoPorKey('no_existe')).toBeUndefined();
    });
  });
});
