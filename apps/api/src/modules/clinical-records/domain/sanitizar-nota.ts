import type { NotaEvolucionContent, PerfilEspecialidad } from '@healthflow/shared-types';
import { sanitizarHtml, sanitizarTextoPlano } from '../../../common/sanitizacion/html-clinico';

/** Campos base que se capturan (o históricamente se guardaron) como HTML. */
const RUTAS_HTML_BASE = [
  'padecimientoActual',
  'planTerapeutico',
  'antecedentesHeredofamiliares',
  'antecedentesPersonalesPatologicos',
  'antecedentesPersonalesNoPatologicos',
];

/**
 * Sanea TODAS las cadenas del contenido de una nota antes de guardarla:
 *
 *   · los campos enriquecidos (base y `texto-rico` de la especialidad) con la
 *     allowlist de HTML;
 *   · cualquier otra cadena —hallazgos, motivos, diagnósticos, bloques,
 *     marcas— como texto plano.
 *
 * Recorre el objeto completo en lugar de enumerar campos: un campo que se
 * agregue mañana queda protegido sin acordarse de este archivo. Los valores
 * que no son cadena se dejan intactos para que la validación estructural los
 * rechace con su ruta.
 */
export function sanitizarNota(
  contenido: NotaEvolucionContent,
  perfil: PerfilEspecialidad,
): NotaEvolucionContent {
  const rutasHtml = new Set([
    ...RUTAS_HTML_BASE,
    ...perfil.camposExtra.filter((c) => c.tipo === 'texto-rico').map((c) => `extension.${c.key}`),
  ]);
  return recorrer(contenido, '', rutasHtml) as NotaEvolucionContent;
}

function recorrer(valor: unknown, ruta: string, rutasHtml: Set<string>): unknown {
  if (typeof valor === 'string') {
    return rutasHtml.has(ruta) ? sanitizarHtml(valor) : sanitizarTextoPlano(valor);
  }
  if (Array.isArray(valor)) {
    return valor.map((v, i) => recorrer(v, `${ruta}.${i}`, rutasHtml));
  }
  if (valor !== null && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor).map(([k, v]) => [
        // Las claves también son texto del cliente (p. ej. `noCapturado`).
        sanitizarTextoPlano(k),
        recorrer(v, ruta ? `${ruta}.${k}` : k, rutasHtml),
      ]),
    );
  }
  return valor;
}
