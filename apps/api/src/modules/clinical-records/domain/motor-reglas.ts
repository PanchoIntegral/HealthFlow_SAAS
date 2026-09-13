import {
  DECLARACIONES_CON_MOTIVO,
  camposDeNota,
  mapaCorporalValido,
  perfilDe,
  plantillaDe,
  type BloqueClinico,
  type CampoEsquema,
  type CampoExtra,
  type ErrorCierre,
  type EsquemaNota,
  type EstadoNoCapturado,
  type NotaEvolucionContent,
  type PerfilEspecialidad,
  type ReglaCampo,
} from '@healthflow/shared-types';
import { hasText } from './nom004-validator';

/**
 * Motor de reglas de la nota clínica. Puro y determinista: recibe el
 * contenido (ya sellado por el servidor) y el perfil, y responde qué campos
 * pide la nota y cuáles faltan para firmar. Sin IA, sin base de datos y sin
 * inferir nada que el médico no haya capturado.
 *
 * Dos pasos separados a propósito:
 *   1. `evaluarEsquema` — QUÉ se pide. Lo mismo alimenta la pantalla y el
 *      cierre, y se congela en la nota firmada (`esquemaAlCierre`).
 *   2. `validarCierre` — si el contenido CUMPLE ese esquema.
 *
 * Compatibilidad: una nota `legacy-v0` ignora `reglas` y se evalúa exactamente
 * como el validador anterior (`obligatorio`, `soloHistoriaClinica`, dispensa
 * de T/A por perfil). Cambiar el catálogo nunca vuelve imposible cerrar una
 * nota abierta con la plantilla vieja.
 */

const RUTA_VERIFICACION = 'verificacionAntecedentes';

/** Campos de antecedentes obligatorios SOLO en la historia clínica inicial. */
const CAMPOS_HISTORIA_CLINICA = [
  'antecedentesHeredofamiliares',
  'antecedentesPersonalesPatologicos',
  'antecedentesPersonalesNoPatologicos',
] as const;

export function evaluarEsquema(
  contenido: NotaEvolucionContent,
  perfil: PerfilEspecialidad = perfilDe(contenido.especialidad),
): EsquemaNota {
  const plantillaVersion = plantillaDe(contenido);
  const conReglas = plantillaVersion !== 'legacy-v0';
  const campos: CampoEsquema[] = [];

  const fijo = (ruta: string, estadosPermitidos: readonly EstadoNoCapturado[] = []): void => {
    campos.push({ ruta, requisito: 'requerido', estadosPermitidos, requiereMotivo: false });
  };

  // Base NOM-004. La T/A sólo admite declarar la omisión si el perfil lo permite.
  fijo('padecimientoActual');
  fijo('signosVitales.ta', perfil.permiteOmitirSignosVitales ? ['no_valorado'] : []);
  fijo('diagnosticos');
  fijo('planTerapeutico');

  for (const campo of camposDeNota(perfil.camposExtra, contenido.tipoNota)) {
    campos.push(resolver(`extension.${campo.key}`, campo, contenido, conReglas));
  }
  for (const bloque of perfil.bloques ?? []) {
    campos.push(resolver(`bloques.${bloque.bloque}`, bloque, contenido, conReglas));
  }

  if (contenido.tipoNota === 'historia_clinica') {
    if (contenido.contextoNota === 'inicial_especialidad') {
      // Ya hay historia general firmada (así se decidió el contexto): sus
      // antecedentes no se recapturan. Lo que se exige es declarar si se
      // verificaron, se actualizaron o no se pudo — y sólo lo propio de la
      // especialidad es captura nueva.
      fijo(RUTA_VERIFICACION);
    } else {
      CAMPOS_HISTORIA_CLINICA.forEach((ruta) => fijo(ruta));
    }
  }
  if (perfil.key === 'heridas_estomas') fijo('mapaCorporal');

  return { plantillaVersion, contextoNota: contenido.contextoNota, campos };
}

/**
 * Requisitos incumplidos, en un orden estable: faltantes de base, especialidad
 * y bloques; valores fuera de rango; antecedentes y mapa; y por último los
 * errores dentro de los elementos de un bloque. Es el mismo orden que devolvía
 * el validador anterior, del que depende la UI actual.
 */
export function validarCierre(
  contenido: NotaEvolucionContent,
  esquema: EsquemaNota,
  perfil: PerfilEspecialidad = perfilDe(contenido.especialidad),
): ErrorCierre[] {
  const primeros: ErrorCierre[] = [];
  const finales: ErrorCierre[] = [];

  for (const campo of esquema.campos) {
    if (campo.requisito !== 'requerido' || tieneDato(contenido, campo.ruta)) continue;
    const error = errorDeNoCaptura(contenido, campo);
    if (!error) continue;
    const esFinal = campo.ruta === 'mapaCorporal' || campo.ruta.startsWith('antecedentes');
    (esFinal ? finales : primeros).push(error);
  }

  if (esquema.campos.some((c) => c.ruta === RUTA_VERIFICACION)) {
    finales.push(...erroresDeVerificacion(contenido));
  }

  return [
    ...primeros,
    ...fueraDeRango(contenido, esquema, perfil),
    ...finales,
    ...erroresDeElementos(contenido),
  ];
}

/** Rutas incumplidas, la forma que ya consume la UI (`missing`). */
export function rutasDeErrores(errores: readonly ErrorCierre[]): string[] {
  return errores.map((e) => e.ruta);
}

// ── Resolución de requisitos ─────────────────────────────────────

function resolver(
  ruta: string,
  def: CampoExtra | BloqueClinico,
  contenido: NotaEvolucionContent,
  conReglas: boolean,
): CampoEsquema {
  const base = {
    ruta,
    estadosPermitidos: def.estadosPermitidos ?? [],
    requiereMotivo: def.requiereMotivoNoCapturado === true,
  };
  if (conReglas && def.reglas && def.reglas.length > 0) {
    // La primera regla que aplica decide; ninguna ⇒ opcional. El orden del
    // catálogo es, por tanto, su prioridad.
    const regla = def.reglas.find((r) => reglaAplica(r, contenido));
    return regla
      ? { ...base, requisito: regla.requisito, reglaId: regla.id }
      : { ...base, requisito: 'opcional' };
  }
  return { ...base, requisito: def.obligatorio ? 'requerido' : 'opcional' };
}

/** Todas las condiciones presentes deben cumplirse; una ausente no restringe. */
export function reglaAplica(regla: ReglaCampo, contenido: NotaEvolucionContent): boolean {
  const { tiposNota, contextosNota, motivos, diagnosticosCie10 } = regla.cuando;
  if (tiposNota?.length && !tiposNota.includes(contenido.tipoNota)) return false;
  if (contextosNota?.length && !(contenido.contextoNota && contextosNota.includes(contenido.contextoNota))) {
    return false;
  }
  if (motivos?.length && !(contenido.motivoConsulta && motivos.includes(contenido.motivoConsulta))) {
    return false;
  }
  if (diagnosticosCie10?.length) {
    const codigos = (contenido.diagnosticos ?? []).map((d) => normalizarCie10(d.cie10));
    const prefijos = diagnosticosCie10.map(normalizarCie10);
    if (!codigos.some((c) => c && prefijos.some((p) => c.startsWith(p)))) return false;
  }
  return true;
}

/** 'i50.9 ' → 'I509': compara prefijos sin depender de puntos ni mayúsculas. */
function normalizarCie10(codigo: string | undefined): string {
  return (codigo ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// ── Qué cuenta como dato capturado ───────────────────────────────

function tieneDato(contenido: NotaEvolucionContent, ruta: string): boolean {
  const [raiz, clave] = dividir(ruta);
  switch (raiz) {
    case 'padecimientoActual':
    case 'planTerapeutico':
    case 'antecedentesHeredofamiliares':
    case 'antecedentesPersonalesPatologicos':
    case 'antecedentesPersonalesNoPatologicos':
      return hasText(contenido[raiz]);
    case 'signosVitales': {
      const v = contenido.exploracionFisica?.signosVitales?.[clave as 'ta'];
      return typeof v === 'number' ? Number.isFinite(v) : Boolean(v?.trim());
    }
    case 'diagnosticos':
      return (contenido.diagnosticos ?? []).some((d) => d.cie10?.trim());
    case 'extension':
      return valorExtensionLleno(contenido.extension?.[clave]);
    case 'mapaCorporal':
      return mapaCorporalValido(contenido.mapaCorporal);
    case 'bloques':
      return bloqueLleno(contenido, clave);
    case RUTA_VERIFICACION:
      return Boolean(contenido.verificacionAntecedentes?.estado);
    default:
      return false;
  }
}

function dividir(ruta: string): [string, string] {
  const i = ruta.indexOf('.');
  return i < 0 ? [ruta, ''] : [ruta.slice(0, i), ruta.slice(i + 1)];
}

function valorExtensionLleno(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  // 0 es una respuesta válida: un índice CPOD de 0 cariados es un dato real.
  if (typeof value === 'number') return Number.isFinite(value);
  // Los campos de texto rico llegan como HTML de TipTap: `<p></p>` está vacío.
  return hasText(value);
}

/**
 * Una lista cuenta si tiene elementos o una declaración explícita; si la
 * declaración dice que algo NO se hizo, además necesita motivo.
 */
function bloqueLleno(contenido: NotaEvolucionContent, clave: string): boolean {
  const b = contenido.bloques;
  if (!b) return false;
  switch (clave) {
    case 'problemas':
    case 'medicamentos':
    case 'estudios': {
      const lista = b[clave];
      if (!lista) return false;
      return lista.items.length > 0 || declaracionValida(lista.declaracion, lista.motivo);
    }
    case 'seguimiento': {
      const s = b.seguimiento;
      if (!s) return false;
      return hasText(s.plazo) || Boolean(s.fecha) || declaracionValida(s.declaracion, s.motivo);
    }
    case 'riesgoCv':
      return (b.riesgoCv ?? []).length > 0;
    case 'pes':
      return (b.pes ?? []).length > 0;
    case 'alergiasVerificadasEn':
      return Boolean(b.alergiasVerificadasEn);
    default:
      return false;
  }
}

function declaracionValida(declaracion: string | undefined, motivo: string | undefined): boolean {
  if (!declaracion) return false;
  return !(DECLARACIONES_CON_MOTIVO as readonly string[]).includes(declaracion) || hasText(motivo);
}

/**
 * El campo no tiene dato: ¿lo justifica una declaración de no captura?
 * Devuelve el error a reportar, o null si la declaración es suficiente.
 */
function errorDeNoCaptura(contenido: NotaEvolucionContent, campo: CampoEsquema): ErrorCierre | null {
  const conRegla = (codigo: ErrorCierre['codigo']): ErrorCierre =>
    campo.reglaId ? { codigo, ruta: campo.ruta, reglaId: campo.reglaId } : { codigo, ruta: campo.ruta };

  // La bandera histórica de omisión de signos vitales equivale a declarar
  // 'no_valorado' en la T/A, sólo si el perfil lo permite.
  if (
    campo.ruta === 'signosVitales.ta' &&
    contenido.signosVitalesOmitidos === true &&
    campo.estadosPermitidos.includes('no_valorado')
  ) {
    return null;
  }

  const declarado = contenido.noCapturado?.[campo.ruta];
  if (!declarado) return conRegla('CAMPO_REQUERIDO');
  if (!campo.estadosPermitidos.includes(declarado.estado)) return conRegla('ESTADO_NO_PERMITIDO');
  if (campo.requiereMotivo && !hasText(declarado.motivo)) return conRegla('MOTIVO_REQUERIDO');
  return null;
}

function fueraDeRango(
  contenido: NotaEvolucionContent,
  esquema: EsquemaNota,
  perfil: PerfilEspecialidad,
): ErrorCierre[] {
  const visibles = new Set(esquema.campos.map((c) => c.ruta));
  const extension = contenido.extension ?? {};
  return perfil.camposExtra
    .filter((campo) => campo.tipo === 'numero' && visibles.has(`extension.${campo.key}`))
    .filter((campo) => {
      const valor = extension[campo.key];
      if (valor === null || valor === undefined || valor === '') return false;
      if (typeof valor !== 'number' || !Number.isFinite(valor)) return true;
      if (campo.min !== undefined && valor < campo.min) return true;
      if (campo.max !== undefined && valor > campo.max) return true;
      return false;
    })
    .map((campo) => ({ codigo: 'FUERA_DE_RANGO' as const, ruta: `extension.${campo.key}` }));
}

/**
 * Lo que cada declaración sobre los antecedentes exige además de elegirla:
 * "no fue posible" necesita motivo, y "actualizados" necesita que lo
 * actualizado esté escrito en esta nota.
 */
function erroresDeVerificacion(contenido: NotaEvolucionContent): ErrorCierre[] {
  const v = contenido.verificacionAntecedentes;
  if (!v) return [];
  if (v.estado === 'no_fue_posible_verificar' && !hasText(v.motivo)) {
    return [{ codigo: 'MOTIVO_REQUERIDO', ruta: RUTA_VERIFICACION }];
  }
  if (v.estado === 'actualizados' && !CAMPOS_HISTORIA_CLINICA.some((c) => hasText(contenido[c]))) {
    return [{ codigo: 'CAMPO_REQUERIDO', ruta: `${RUTA_VERIFICACION}.actualizacion` }];
  }
  return [];
}

/** Reglas internas de los elementos de un bloque, se pida o no el bloque. */
function erroresDeElementos(contenido: NotaEvolucionContent): ErrorCierre[] {
  const errores: ErrorCierre[] = [];
  contenido.bloques?.medicamentos?.items.forEach((m, i) => {
    // Cambiar un tratamiento sin decir por qué es justo el hueco que la
    // conciliación farmacológica existe para cerrar.
    if (m.cambio !== 'sin_cambio' && !hasText(m.razonCambio)) {
      errores.push({ codigo: 'MOTIVO_REQUERIDO', ruta: `bloques.medicamentos.${i}.razonCambio` });
    }
  });
  return errores;
}
