import {
  CARAS_DIENTE,
  ESTADOS_DENTALES,
  type CampoExtra,
  type NotaEvolucionContent,
  type PerfilEspecialidad,
} from '@healthflow/shared-types';

/**
 * Construye el prompt de extracción a partir del perfil de especialidad.
 *
 * Función PURA: mismo perfil ⇒ mismo prompt, sin red ni estado. Eso la hace
 * testeable sin gastar un peso en el modelo, que es justo lo que se quiere de
 * la pieza donde vive la calidad clínica de la función.
 *
 * El esquema se DERIVA del catálogo PERFILES (shared-types) en vez de estar
 * escrito a mano: agregar una especialidad nueva al catálogo hace que la IA
 * empiece a llenar sus campos sin tocar este archivo, igual que pasa con el
 * formulario que ve el médico.
 */
export function construirPrompt(
  perfil: PerfilEspecialidad,
  yaLlenados: Partial<NotaEvolucionContent>,
): string {
  const vitales = perfil.signosVitales.map((v) => `"${v}"`).join(', ');
  const etiqueta = (key: 'padecimientoActual' | 'hallazgos' | 'planTerapeutico') =>
    perfil.etiquetas?.[key]?.label ?? DEFAULTS[key];

  return `Eres un asistente de transcripción clínica para un consultorio médico en México.
Especialidad de esta consulta: ${perfil.nombre}.

Vas a escuchar el audio de una consulta real (médico y paciente). Tu ÚNICA tarea
es extraer lo que efectivamente se dijo y acomodarlo en los campos de la nota.

REGLAS INVIOLABLES
1. NUNCA inventes. Si algo no se mencionó en el audio, omite esa clave del JSON
   o mándala como null. Un campo vacío es correcto; un campo inventado es un
   error médico.
2. No infieras diagnósticos, dosis ni cifras que no se hayan dicho en voz alta.
   Si el médico dijo "la presión está bien" sin dar el número, NO inventes
   "120/80": deja el campo vacío.
3. No traduzcas ni "mejores" lo que dijo el médico: usa su vocabulario clínico.
4. Escribe en español de México, en tercera persona, tono de nota clínica.
5. Si el audio está en silencio, es ruido, o no es una consulta médica, devuelve
   todos los campos vacíos y explica por qué en "advertencias".

FORMATO
Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con
esta forma exacta:

{
  "padecimientoActual": string | null,   // ${etiqueta('padecimientoActual')}. HTML simple.
  "hallazgos": string | null,            // ${etiqueta('hallazgos')}. TEXTO PLANO, sin HTML.
  "planTerapeutico": string | null,      // ${etiqueta('planTerapeutico')}. HTML simple.
  "signosVitales": { ${vitales} },       // solo estos; cada uno string o null
  "diagnosticos": [ { "cie10": string, "descripcion": string } ],
  "extension": { ${camposExtraShape(perfil.camposExtra)} },${odontogramaShape(perfil)}
  "advertencias": [ string ]
}

HTML SIMPLE significa: solo <p>, <ul>, <li>, <strong> y <em>. Nada de estilos,
clases, scripts, encabezados ni tablas. Un párrafo por idea.

"hallazgos" va en TEXTO PLANO —sin ninguna etiqueta— porque se captura en un
campo simple: cualquier HTML ahí se vería como <p> literal en el expediente.

SIGNOS VITALES
Incluye solo las claves listadas arriba — son las que esta especialidad
registra. Valores como el médico los dictó ("120/80", "72", "36.5"), sin
unidades ni texto extra. Si no se mencionó un signo, null.

DIAGNÓSTICOS
Son SUGERENCIAS que el médico revisará y decidirá si acepta; nunca los
presentes como definitivos ni agregues códigos "por si acaso". Solo propón un
diagnóstico si el médico nombró la condición.${rangosCie10(perfil)}
Si no estás seguro del código exacto, devuelve el arreglo vacío antes que un
código equivocado: un CIE-10 mal puesto contamina las estadísticas de la
clínica y los reportes que salen de ellas.
${camposExtraDetalle(perfil.camposExtra)}${odontogramaDetalle(perfil)}${contextoYaLlenado(yaLlenados)}`;
}

const DEFAULTS = {
  padecimientoActual: 'Padecimiento actual',
  hallazgos: 'Hallazgos de la exploración física',
  planTerapeutico: 'Plan terapéutico e indicaciones',
} as const;

/** Forma inline de `extension` dentro del esquema JSON. */
function camposExtraShape(campos: readonly CampoExtra[]): string {
  if (campos.length === 0) return '';
  return campos.map((c) => `"${c.key}": ${tipoJson(c)}`).join(', ');
}

function tipoJson(campo: CampoExtra): string {
  return campo.tipo === 'numero' ? 'number | null' : 'string | null';
}

/**
 * Detalle de los campos propios de la especialidad. Va aparte del esquema
 * porque las opciones de un `seleccion` y la ayuda de cada campo son lo que
 * hace que el modelo llene bien un campo como "Higiene bucal" en vez de
 * escribir cualquier sinónimo.
 */
function camposExtraDetalle(campos: readonly CampoExtra[]): string {
  if (campos.length === 0) return '';

  const lineas = campos.map((c) => {
    const partes = [`- "${c.key}" (${c.label})`];
    if (c.tipo === 'seleccion' && c.opciones?.length) {
      partes.push(`valor EXACTO de esta lista: ${c.opciones.join(' | ')}`);
    }
    if (c.tipo === 'numero') partes.push(`número${c.unidad ? ` en ${c.unidad}` : ''}`);
    if (c.tipo === 'texto-rico') partes.push('HTML simple');
    if (c.ayuda) partes.push(c.ayuda);
    return partes.join(' — ');
  });

  return `
CAMPOS DE LA ESPECIALIDAD (clave "extension")
${lineas.join('\n')}
`;
}

/**
 * El odontograma solo se le pide a odontología: es la única especialidad que
 * lo captura, y pedirlo en las demás sería ruido en el prompt (y tokens que
 * se pagan en cada consulta).
 */
function esDental(perfil: PerfilEspecialidad): boolean {
  return perfil.key === 'odontologia';
}

function odontogramaShape(perfil: PerfilEspecialidad): string {
  if (!esDental(perfil)) return '';
  return `
  "odontograma": [ { "pieza": string, "cara": string | null, "estado": string } ],`;
}

/**
 * Instrucciones del odontograma.
 *
 * Es la parte con más riesgo de toda la extracción: una pieza equivocada no es
 * una falta de ortografía, es marcar caries en el diente sano de al lado. De
 * ahí el tono de las reglas — ante la duda, no marcar.
 */
function odontogramaDetalle(perfil: PerfilEspecialidad): string {
  if (!esDental(perfil)) return '';

  const porCara = ESTADOS_DENTALES.filter((e) => !e.piezaCompleta).map((e) => e.key);
  const completos = ESTADOS_DENTALES.filter((e) => e.piezaCompleta).map((e) => e.key);

  return `
ODONTOGRAMA (clave "odontograma")
Una entrada por hallazgo dental que el médico haya dicho EN VOZ ALTA.
- "pieza": notación FDI de dos dígitos ("16", "26", "47"). Permanentes 11-18,
  21-28, 31-38, 41-48; temporales 51-55, 61-65, 71-75, 81-85. Si el médico dijo
  el nombre del diente sin número ("el primer molar inferior derecho"), tradúcelo
  a FDI ("46") solo si la lateralidad y la posición son inequívocas.
- "cara": ${CARAS_DIENTE.join(' | ')}, o null si el hallazgo es de la pieza completa.
  Estados por cara: ${porCara.join(', ')}.
  Estados de pieza completa (cara SIEMPRE null): ${completos.join(', ')}.
- "estado": exactamente una de estas claves: ${ESTADOS_DENTALES.map((e) => e.key).join(', ')}.

REGLA CRÍTICA: si no estás seguro de QUÉ pieza es, NO la incluyas. Marcar el
diente equivocado en un expediente es peor que no marcar nada — el dentista
puede agregar lo que falte con un clic, pero un hallazgo puesto en la pieza
vecina puede acabar en un tratamiento sobre un diente sano. Un diente del que
solo se dijo que está bien NO se marca: la salud es la ausencia de marca.
`;
}

function rangosCie10(perfil: PerfilEspecialidad): string {
  if (perfil.rangosCie10.length === 0) return '';
  const rangos = perfil.rangosCie10.map((r) => `${r.desde}–${r.hasta}`).join(', ');
  // Prioriza, no restringe: un dentista debe poder codificar la diabetes que
  // condiciona el tratamiento periodontal.
  return ` En esta especialidad son frecuentes los capítulos ${rangos}, pero no te limites a ellos si la consulta trató otra cosa.`;
}

/**
 * Lo que el médico ya escribió a mano, como contexto de solo lectura.
 *
 * Sin esto el modelo repite lo mismo que ya está en pantalla y el médico
 * termina borrando duplicados — la función acaba costándole tiempo en vez de
 * ahorrárselo.
 */
function contextoYaLlenado(yaLlenados: Partial<NotaEvolucionContent>): string {
  const escritos: string[] = [];
  if (textoUtil(yaLlenados.padecimientoActual)) escritos.push('padecimientoActual');
  if (textoUtil(yaLlenados.exploracionFisica?.hallazgos)) escritos.push('hallazgos');
  if (textoUtil(yaLlenados.planTerapeutico)) escritos.push('planTerapeutico');
  if (yaLlenados.diagnosticos?.length) escritos.push('diagnosticos');

  if (escritos.length === 0) return '';

  return `
YA CAPTURADO POR EL MÉDICO
El médico ya escribió a mano: ${escritos.join(', ')}. No repitas ese contenido;
complementa solo si el audio aporta algo que ahí no está. Si no hay nada que
agregar en esos campos, mándalos como null.
`;
}

/** HTML vacío de TipTap ("<p></p>") cuenta como no escrito. */
function textoUtil(valor: string | undefined): boolean {
  if (!valor) return false;
  return valor.replace(/<[^>]*>/g, '').trim().length > 0;
}
