import sanitizeHtml from 'sanitize-html';

/**
 * Sanitización del texto que termina dentro de un expediente clínico.
 *
 * El HTML de los campos enriquecidos lo produce TipTap en el navegador, pero
 * el servidor no puede confiar en eso: el contenido llega entero del cliente
 * (o de un modelo de IA) y una nota firmada NO se puede corregir después
 * (trigger de 0052). Lo que se guarda tiene que ser seguro para siempre, y
 * para cualquier lector futuro: el editor, una impresión, un PDF o una
 * exportación.
 *
 * Allowlist mínima, compatible con lo que emite el StarterKit de TipTap:
 * párrafos, saltos, énfasis, listas, citas, código y encabezados cortos.
 * Sin atributos (salvo `start` numérico en listas ordenadas) y SIN enlaces ni
 * imágenes: así ninguna URL —`javascript:`, `data:` o cualquier otra— puede
 * persistir como algo que el navegador ejecute o cargue.
 *
 * Usa un parser real (htmlparser2) y no expresiones regulares: un filtro por
 * regex se evade con HTML mal formado, y aquí el costo de evadirlo es un
 * script almacenado dentro de un documento médico-legal inmutable.
 */
const OPCIONES: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'strong', 'b', 'em', 'i', 's',
    'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'hr',
    'h1', 'h2', 'h3',
  ],
  allowedAttributes: { ol: ['start'] },
  allowedSchemes: [],
  allowedSchemesAppliedToAttributes: [],
  allowProtocolRelative: false,
  allowVulnerableTags: false,
  // Se descarta la etiqueta y se conserva su texto; el CONTENIDO de estas se
  // descarta completo (un <script> no deja su código como texto).
  disallowedTagsMode: 'discard',
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'template', 'svg', 'math', 'title', 'head'],
  parseStyleAttributes: false,
  transformTags: {
    ol: (tagName, attribs) => {
      const start = attribs.start ?? '';
      return { tagName, attribs: /^\d{1,4}$/.test(start) ? { start } : ({} as Record<string, string>) };
    },
  },
};

/** HTML enriquecido reducido a la allowlist. Idempotente. */
export function sanitizarHtml(valor: string): string {
  return sanitizeHtml(valor, OPCIONES);
}

/**
 * Texto de un control simple (input, textarea): se quitan secuencias con
 * forma de etiqueta, sin escapar el resto, para no convertir "TA < 140" en
 * "TA &lt; 140". Se repite hasta estabilizar para que etiquetas anidadas o
 * partidas no se recompongan al quitar la de adentro.
 */
export function sanitizarTextoPlano(valor: string): string {
  // El contenido de un script o estilo no es texto de la nota: se va entero.
  let actual = valor.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '');
  for (let i = 0; i < 10; i++) {
    const siguiente = actual.replace(/<\/?[a-zA-Z!?][^>]*>?/g, '');
    if (siguiente === actual) return siguiente;
    actual = siguiente;
  }
  // Entrada adversaria que no converge: se neutraliza todo '<'.
  return actual.replace(/</g, '');
}
