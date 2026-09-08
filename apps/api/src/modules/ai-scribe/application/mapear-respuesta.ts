import {
  CARAS_DIENTE,
  estadoDentalPorKey,
  piezasDeCuadrante,
  type CampoExtra,
  type CaraDiente,
  type DiagnosticoCie10,
  type MarcaDental,
  type PerfilEspecialidad,
  type SignosVitales,
  type SugerenciaNotaIa,
} from '@healthflow/shared-types';
import { AsistenteIaRespuestaInvalidaError } from '../domain/asistente-ia.errors';
import type { ExtraccionClinicaResult } from '../domain/asistente-clinico-ia.port';

/** Etiquetas permitidas en los campos de texto rico (mismo set que pide el prompt). */
const TAGS_PERMITIDOS = ['p', 'ul', 'ol', 'li', 'strong', 'em', 'br'];

/**
 * Convierte el texto que devolvió el modelo en un `Partial<NotaEvolucionContent>`.
 *
 * Todo aquí es defensivo por diseño. Aunque se le pida JSON al modelo y aunque
 * el proveedor prometa respetarlo, esto es una entrada NO CONFIABLE que va a
 * terminar dentro de un expediente clínico: se valida clave por clave, se
 * descarta lo que no cuadra en vez de tronar, y solo se rinde —lanzando
 * AsistenteIaRespuestaInvalidaError— cuando ni siquiera hay JSON que leer.
 *
 * Descartar un campo malo y conservar el resto es intencional: si el modelo
 * acertó en el padecimiento y falló en un número, el médico prefiere quedarse
 * con el padecimiento.
 */
export function mapearRespuesta(texto: string, perfil: PerfilEspecialidad): ExtraccionClinicaResult {
  const crudo = parsearJson(texto);

  const contenido: SugerenciaNotaIa = {};
  const advertencias = arregloDeTexto(crudo.advertencias);

  const padecimiento = htmlLimpio(crudo.padecimientoActual);
  if (padecimiento) contenido.padecimientoActual = padecimiento;

  const plan = htmlLimpio(crudo.planTerapeutico);
  if (plan) contenido.planTerapeutico = plan;

  // Hallazgos se captura en un textarea simple: si el modelo manda HTML —y a
  // veces lo hará, por más que el prompt lo prohíba— el médico vería "<p>" a
  // secas dentro de su nota. Se aplana aquí, en el borde, y no se confía.
  const hallazgos = textoPlano(crudo.hallazgos);
  if (hallazgos) contenido.hallazgos = hallazgos;

  const signos = signosVitalesDe(crudo.signosVitales, perfil);
  if (signos) contenido.signosVitales = signos;

  const diagnosticos = diagnosticosDe(crudo.diagnosticos);
  if (diagnosticos.length > 0) contenido.diagnosticos = diagnosticos;

  const extension = extensionDe(crudo.extension, perfil.camposExtra);
  if (Object.keys(extension).length > 0) contenido.extension = extension;

  const marcas = odontogramaDe(crudo.odontograma);
  if (marcas.length > 0) contenido.odontograma = marcas;

  if (Object.keys(contenido).length === 0) {
    advertencias.push('No se detectó contenido clínico en el audio.');
  }

  return { contenido, advertencias };
}

/**
 * El modelo a veces envuelve el JSON en ```json … ``` aunque se le pida lo
 * contrario. Se limpia antes de rendirse: fallar por unas comillas de bloque
 * sería tirar una transcripción buena.
 */
function parsearJson(texto: string): Record<string, unknown> {
  const limpio = texto
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  try {
    const parsed: unknown = JSON.parse(limpio);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new AsistenteIaRespuestaInvalidaError();
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof AsistenteIaRespuestaInvalidaError) throw err;
    throw new AsistenteIaRespuestaInvalidaError();
  }
}

/**
 * Texto rico saneado. El HTML del modelo entra a un editor y se guarda en el
 * expediente, así que se recorta a las etiquetas del prompt: cualquier otra
 * cosa (un <script>, un onerror, un style) se queda fuera por construcción y
 * no por confiar en que el modelo se portó bien.
 */
function htmlLimpio(valor: unknown): string | undefined {
  if (typeof valor !== 'string') return undefined;
  const sinTags = valor.replace(/<\/?([a-zA-Z0-9]+)(?:\s[^>]*)?>/g, (match, tag: string) =>
    TAGS_PERMITIDOS.includes(tag.toLowerCase()) ? `<${match.startsWith('</') ? '/' : ''}${tag.toLowerCase()}>` : '',
  );
  return sinTags.replace(/<[^>]*>/g, '').trim().length > 0 ? sinTags.trim() : undefined;
}

/**
 * Texto sin etiquetas, para los campos que se capturan en controles simples.
 * Los cierres de párrafo y los <br> se vuelven saltos de línea para no pegar
 * dos ideas en un renglón.
 */
function textoPlano(valor: unknown): string | undefined {
  if (typeof valor !== 'string') return undefined;
  const plano = valor
    .replace(/<\/(p|li|div)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return plano.length > 0 ? plano : undefined;
}

/** Solo los signos que esta especialidad registra; el resto se ignora. */
function signosVitalesDe(
  valor: unknown,
  perfil: PerfilEspecialidad,
): Partial<SignosVitales> | undefined {
  if (!esObjeto(valor)) return undefined;

  const signos: Partial<SignosVitales> = {};
  for (const key of perfil.signosVitales) {
    const v = valor[key];
    if (typeof v === 'string' && v.trim()) signos[key] = v.trim();
    else if (typeof v === 'number') signos[key] = String(v);
  }
  return Object.keys(signos).length > 0 ? signos : undefined;
}

/**
 * Diagnósticos con forma de CIE-10. El formato del código se valida aquí (una
 * letra + dos dígitos, con subcategoría opcional): un código con forma
 * inválida no existe en el catálogo y solo ensuciaría los reportes.
 */
function diagnosticosDe(valor: unknown): DiagnosticoCie10[] {
  if (!Array.isArray(valor)) return [];

  const vistos = new Set<string>();
  const salida: DiagnosticoCie10[] = [];

  for (const item of valor) {
    if (!esObjeto(item)) continue;
    const cie10 = typeof item.cie10 === 'string' ? item.cie10.trim().toUpperCase() : '';
    const descripcion = typeof item.descripcion === 'string' ? item.descripcion.trim() : '';
    if (!/^[A-Z]\d{2}(\.[0-9A-Z]{1,2})?$/.test(cie10) || !descripcion) continue;
    if (vistos.has(cie10)) continue;
    vistos.add(cie10);
    salida.push({ cie10, descripcion });
  }
  return salida;
}

/** Campos propios de la especialidad, tipados según el catálogo. */
function extensionDe(
  valor: unknown,
  campos: readonly CampoExtra[],
): Record<string, string | number | null> {
  if (!esObjeto(valor)) return {};

  const salida: Record<string, string | number | null> = {};
  for (const campo of campos) {
    const v = valor[campo.key];
    if (v === null || v === undefined) continue;

    if (campo.tipo === 'numero') {
      const n = typeof v === 'number' ? v : Number(v);
      const dentroDeRango =
        Number.isFinite(n) &&
        (campo.min === undefined || n >= campo.min) &&
        (campo.max === undefined || n <= campo.max);
      if (dentroDeRango) salida[campo.key] = n;
      continue;
    }

    if (typeof v !== 'string' || !v.trim()) continue;

    // Un `seleccion` fuera de su catálogo se descarta: el formulario solo
    // acepta esas opciones, y dejar pasar un valor libre rompería el <select>.
    if (campo.tipo === 'seleccion') {
      const opcion = campo.opciones?.find((o) => o.toLowerCase() === v.trim().toLowerCase());
      if (opcion) salida[campo.key] = opcion;
      continue;
    }

    // El formulario persiste una selección múltiple como opciones canónicas
    // separadas por coma. El modelo puede cambiar mayúsculas, pero no inventar
    // valores fuera del catálogo ni repetir una misma opción.
    if (campo.tipo === 'multi-seleccion') {
      const elegidas: string[] = [];
      for (const cruda of v.split(',')) {
        const opcion = campo.opciones?.find(
          (o) => o.toLowerCase() === cruda.trim().toLowerCase(),
        );
        if (opcion && !elegidas.includes(opcion)) elegidas.push(opcion);
      }
      if (elegidas.length > 0) salida[campo.key] = elegidas.join(',');
      continue;
    }

    // 'texto' se captura en un input simple ⇒ se aplana; 'texto-rico' va al
    // editor ⇒ conserva su HTML, ya saneado.
    const limpio = campo.tipo === 'texto-rico' ? htmlLimpio(v) : textoPlano(v);
    if (limpio) salida[campo.key] = limpio;
  }
  return salida;
}

/** Todas las piezas FDI válidas, permanentes y temporales. */
const PIEZAS_VALIDAS = new Set(
  [1, 2, 3, 4, 5, 6, 7, 8].flatMap((cuadrante) => piezasDeCuadrante(cuadrante)),
);

/**
 * Marcas del odontograma. La validación es deliberadamente estricta: aquí un
 * dato mal formado no produce un texto raro, produce un hallazgo en el diente
 * equivocado, y de ahí sale un presupuesto y eventualmente un tratamiento.
 *
 * Se descarta —sin tumbar el resto— cualquier marca cuya pieza no exista en la
 * notación FDI, cuyo estado no esté en el catálogo, o cuya cara no aplique.
 */
function odontogramaDe(valor: unknown): MarcaDental[] {
  if (!Array.isArray(valor)) return [];

  const vistas = new Set<string>();
  const marcas: MarcaDental[] = [];

  for (const item of valor) {
    if (!esObjeto(item)) continue;

    const pieza = typeof item.pieza === 'string' ? item.pieza.trim() : '';
    if (!PIEZAS_VALIDAS.has(pieza)) continue;

    const estadoKey = typeof item.estado === 'string' ? item.estado.trim().toLowerCase() : '';
    const estado = estadoDentalPorKey(estadoKey);
    if (!estado) continue;

    const caraCruda = typeof item.cara === 'string' ? item.cara.trim().toLowerCase() : null;
    const cara = (CARAS_DIENTE as readonly string[]).includes(caraCruda ?? '')
      ? (caraCruda as CaraDiente)
      : undefined;

    // Un estado de pieza completa (ausente, corona, implante…) no admite cara:
    // el catálogo lo dice y el odontograma lo pinta así. Si el modelo mandó
    // una, se ignora en vez de generar una marca que la interfaz no sabe
    // dibujar. Y al revés: un estado por cara SIN cara no se puede colocar.
    if (estado.piezaCompleta) {
      const clave = `${pieza}|${estado.key}`;
      if (vistas.has(clave)) continue;
      vistas.add(clave);
      marcas.push({ pieza, estado: estado.key });
      continue;
    }

    if (!cara) continue;
    const clave = `${pieza}|${cara}|${estado.key}`;
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    marcas.push({ pieza, cara, estado: estado.key });
  }

  return marcas;
}

function arregloDeTexto(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, 5);
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return !!valor && typeof valor === 'object' && !Array.isArray(valor);
}
