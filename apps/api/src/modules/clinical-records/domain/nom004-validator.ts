import type { NotaEvolucionContent } from '@healthflow/shared-types';

/**
 * Validador de dominio NOM-004. Vive en el BACKEND (nunca solo en el front):
 * es la regla que impide cerrar una nota incompleta. Devuelve la lista de
 * campos obligatorios faltantes (vacía = la nota puede cerrarse).
 *
 * Obligatorios para una nota de evolución (versión simplificada):
 *  - padecimiento actual (texto no vacío)
 *  - signos vitales: tensión arterial
 *  - al menos un diagnóstico con código CIE-10
 *  - plan terapéutico (texto no vacío)
 */
export class NOM004Validator {
  static validateNotaEvolucion(content: NotaEvolucionContent): string[] {
    const missing: string[] = [];

    if (!hasText(content.padecimientoActual)) {
      missing.push('padecimientoActual');
    }
    if (!content.exploracionFisica?.signosVitales?.ta?.trim()) {
      missing.push('signosVitales.ta');
    }
    const diagnosticosValidos = (content.diagnosticos ?? []).filter((d) => d.cie10?.trim());
    if (diagnosticosValidos.length === 0) {
      missing.push('diagnosticos');
    }
    if (!hasText(content.planTerapeutico)) {
      missing.push('planTerapeutico');
    }

    return missing;
  }
}

/** True si el string tiene contenido real (ignora HTML vacío de TipTap). */
function hasText(value: string | undefined): boolean {
  if (!value) return false;
  const stripped = value.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  return stripped.length > 0;
}
