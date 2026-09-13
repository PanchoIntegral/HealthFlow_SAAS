import type {
  BloqueClinico,
  CampoEsquema,
  CodigoErrorCierre,
  ContextoNota,
  ErrorCierre,
  EsquemaNota,
  EstadoNoCapturado,
  PerfilEspecialidad,
} from '@healthflow/shared-types';

/**
 * Lectura del esquema que calcula la API. Todo aquí es BUSCAR y NOMBRAR:
 * ninguna función decide si un campo se pide o si está completo — eso lo
 * responde el servidor en `esquema` y `pendientes`. Si mañana cambia una
 * regla, este archivo no se toca.
 */

export function campoDe(esquema: EsquemaNota | undefined, ruta: string): CampoEsquema | undefined {
  return esquema?.campos.find((c) => c.ruta === ruta);
}

export function esRequerido(esquema: EsquemaNota | undefined, ruta: string): boolean {
  return campoDe(esquema, ruta)?.requisito === 'requerido';
}

/** Errores de una ruta o de sus sub-rutas (`bloques.medicamentos.0.razonCambio`). */
export function erroresDe(pendientes: readonly ErrorCierre[], ruta: string): ErrorCierre[] {
  return pendientes.filter((p) => p.ruta === ruta || p.ruta.startsWith(`${ruta}.`));
}

/** Rutas `extension.*` del esquema, en el orden en que la API las evaluó. */
export function clavesExtension(esquema: EsquemaNota | undefined): string[] {
  return (esquema?.campos ?? [])
    .filter((c) => c.ruta.startsWith('extension.'))
    .map((c) => c.ruta.slice('extension.'.length));
}

export function bloquesDelEsquema(
  esquema: EsquemaNota | undefined,
  perfil: PerfilEspecialidad,
): { def: BloqueClinico; campo: CampoEsquema }[] {
  return (perfil.bloques ?? []).flatMap((def) => {
    const campo = campoDe(esquema, `bloques.${def.bloque}`);
    return campo ? [{ def, campo }] : [];
  });
}

export const ETIQUETA_ESTADO_NO_CAPTURADO: Record<EstadoNoCapturado, string> = {
  no_aplica: 'No aplica',
  no_valorado: 'No valorado',
  rechazado_por_paciente: 'Rechazado por el paciente',
};

export const ETIQUETA_CONTEXTO: Record<ContextoNota, string> = {
  general: 'Historia clínica general',
  inicial_especialidad: 'Primera valoración de especialidad',
  seguimiento: 'Seguimiento',
};

const MENSAJE_CODIGO: Record<CodigoErrorCierre, string> = {
  CAMPO_REQUERIDO: 'Falta capturarlo',
  MOTIVO_REQUERIDO: 'Falta el motivo',
  ESTADO_NO_PERMITIDO: 'Ese estado no se permite aquí',
  FUERA_DE_RANGO: 'Valor fuera de rango',
};

export function mensajeDeError(error: ErrorCierre): string {
  if (error.ruta === 'verificacionAntecedentes.actualizacion') {
    return 'Escribe los antecedentes actualizados';
  }
  return MENSAJE_CODIGO[error.codigo] ?? 'Revisar';
}

const ETIQUETAS_FIJAS: Record<string, string> = {
  padecimientoActual: 'Padecimiento actual',
  'signosVitales.ta': 'Tensión arterial',
  diagnosticos: 'Diagnósticos (CIE-10)',
  planTerapeutico: 'Plan terapéutico',
  antecedentesHeredofamiliares: 'Antecedentes heredofamiliares',
  antecedentesPersonalesPatologicos: 'Antecedentes personales patológicos',
  antecedentesPersonalesNoPatologicos: 'Antecedentes personales no patológicos',
  mapaCorporal: 'Ubicación anatómica',
  verificacionAntecedentes: 'Verificación de antecedentes',
};

/** Nombre legible de una ruta, para la lista de pendientes. */
export function etiquetaDeRuta(ruta: string, perfil: PerfilEspecialidad): string {
  const [raiz, clave, ...resto] = ruta.split('.');
  if (raiz === 'extension' && clave) {
    return perfil.camposExtra.find((c) => c.key === clave)?.label ?? clave;
  }
  if (raiz === 'bloques' && clave) {
    const label = perfil.bloques?.find((b) => b.bloque === clave)?.label ?? clave;
    return resto.length > 0 ? `${label} · elemento ${Number(resto[0]) + 1}` : label;
  }
  if (raiz === 'verificacionAntecedentes') return ETIQUETAS_FIJAS.verificacionAntecedentes!;
  return ETIQUETAS_FIJAS[ruta] ?? ruta;
}
