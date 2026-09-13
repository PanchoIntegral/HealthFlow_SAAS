import {
  CATALOGO_NOTAS_V1,
  catalogoAprobado,
  esEspecialidadValida,
  type CatalogoNotas,
} from '@healthflow/shared-types';

/**
 * ¿Se puede encender notas_v2 para esta especialidad?
 *
 * Sólo si su catálogo versionado está APROBADO, con responsable clínico,
 * responsable legal, fecha y referencia registrados en el código. Un borrador
 * no se enciende, y no existe bandera para saltarse esto: la aprobación es un
 * commit revisado, no una opción de línea de comandos.
 *
 * Devuelve el motivo del rechazo, o null si procede.
 */
export function motivoParaNoActivar(
  especialidad: string,
  catalogo: CatalogoNotas = CATALOGO_NOTAS_V1,
): string | null {
  if (!esEspecialidadValida(especialidad)) return `especialidad desconocida: ${especialidad}`;
  const entrada = catalogo.especialidades[especialidad];
  if (!entrada) return `la especialidad ${especialidad} no tiene catálogo ${catalogo.version}`;
  if (!catalogoAprobado(entrada)) {
    return `el catálogo ${catalogo.version} de ${especialidad} está en estado '${entrada.estado}' sin aprobación clínico-legal completa`;
  }
  return null;
}
