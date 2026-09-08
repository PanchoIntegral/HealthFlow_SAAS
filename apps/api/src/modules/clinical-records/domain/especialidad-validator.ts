import {
  camposDeNota,
  perfilDe,
  type NotaEvolucionContent,
  type PerfilEspecialidad,
} from '@healthflow/shared-types';
import { NOM004Validator, hasText } from './nom004-validator';

/** Campos de antecedentes obligatorios SOLO en la historia clínica inicial. */
const CAMPOS_HISTORIA_CLINICA = [
  'antecedentesHeredofamiliares',
  'antecedentesPersonalesPatologicos',
  'antecedentesPersonalesNoPatologicos',
] as const;

/**
 * Validador de cierre de nota, en dos capas:
 *
 *   1. NOM-004 — la base legal, común a toda especialidad.
 *   2. Los campos que el perfil de la especialidad marque como obligatorios.
 *      Para odontología esto materializa la NOM-013-SSA2-2015, que exige
 *      registrar el tratamiento de cada sesión y las piezas intervenidas.
 *
 * La única dispensa posible sobre la base es la tensión arterial, y no es un
 * "campo opcional": obliga al médico a DECLARAR la omisión, que queda escrita
 * en la nota. Un expediente con un hueco sin explicación no defiende a nadie.
 *
 * Devuelve la lista de campos faltantes; vacía = la nota puede cerrarse.
 */
export class EspecialidadValidator {
  static validar(content: NotaEvolucionContent): string[] {
    /**
     * Degradado seguro: `perfilDe` nunca lanza y cae a 'general' ante una
     * clave desconocida. Es deliberado — si una especialidad se retira del
     * catálogo, o la nota es anterior a esta función, el médico debe poder
     * firmar cumpliendo la base NOM-004. Un cambio de configuración jamás
     * puede dejar una nota clínica atrapada sin poder cerrarse.
     */
    const perfil: PerfilEspecialidad = perfilDe(content.especialidad);
    const extension = content.extension ?? {};

    /**
     * Omisión declarada de signos vitales. Libera ÚNICAMENTE la tensión
     * arterial, y solo si la especialidad lo permite y el médico lo marcó
     * explícitamente en la nota: una nota vieja o una especialidad sin el
     * permiso siguen exigiéndola, aunque venga la bandera puesta.
     */
    const omiteVitales =
      perfil.permiteOmitirSignosVitales === true && content.signosVitalesOmitidos === true;

    const base = NOM004Validator.validateNotaEvolucion(content).filter(
      (campo) => !(omiteVitales && campo === 'signosVitales.ta'),
    );

    // Solo se exige lo que la nota REALMENTE muestra: un campo de primera
    // visita oculto en una subsecuente no puede bloquear el cierre.
    const faltantesEspecialidad = camposDeNota(perfil.camposExtra, content.tipoNota)
      .filter((campo) => campo.obligatorio && !tieneValor(extension[campo.key]))
      // Se prefija con `extension.` para que el frontend pueda resaltar el
      // campo exacto sin que choque con los nombres de los campos base.
      .map((campo) => `extension.${campo.key}`);

    const numerosFueraDeRango = camposDeNota(perfil.camposExtra, content.tipoNota)
      .filter((campo) => {
        if (campo.tipo !== 'numero') return false;
        const valor = extension[campo.key];
        if (valor === null || valor === undefined || valor === '') return false;
        if (typeof valor !== 'number' || !Number.isFinite(valor)) return true;
        if (campo.min !== undefined && valor < campo.min) return true;
        if (campo.max !== undefined && valor > campo.max) return true;
        return false;
      })
      .map((campo) => `extension.${campo.key}`);

    // NOM-004 exige antecedentes completos en la primera visita. Son claves
    // planas (sin prefijo), igual que padecimientoActual/planTerapeutico.
    const faltantesHistoria =
      content.tipoNota === 'historia_clinica'
        ? CAMPOS_HISTORIA_CLINICA.filter((campo) => !hasText(content[campo]))
        : [];

    return [...base, ...faltantesEspecialidad, ...numerosFueraDeRango, ...faltantesHistoria];
  }
}

/** True si el valor capturado cuenta como llenado. */
function tieneValor(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  // 0 es una respuesta válida: un índice CPOD de 0 cariados es un dato real.
  if (typeof value === 'number') return Number.isFinite(value);
  // Los campos de texto rico llegan como HTML de TipTap: `<p></p>` está vacío.
  return value.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0;
}
