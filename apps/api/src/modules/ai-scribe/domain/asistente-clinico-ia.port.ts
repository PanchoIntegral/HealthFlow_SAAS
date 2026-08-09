import type {
  NotaEvolucionContent,
  PerfilEspecialidad,
  SugerenciaNotaIa,
} from '@healthflow/shared-types';

export interface ExtraccionClinicaRequest {
  /** Audio crudo de la consulta. Vive solo en memoria — jamás se persiste. */
  audio: Buffer;
  mimeType: string;
  /** Perfil de la especialidad con la que se abrió la nota: dicta qué campos pedir. */
  perfil: PerfilEspecialidad;
  /** Lo que el médico ya tecleó, para que el modelo complemente en vez de repetir. */
  camposYaLlenados: Partial<NotaEvolucionContent>;
}

export interface ExtraccionClinicaResult {
  /** Solo lo que se pudo inferir. Ausente = no se mencionó (nunca inventado). */
  contenido: SugerenciaNotaIa;
  advertencias: string[];
}

/**
 * Puerto del asistente que convierte el audio de una consulta en un borrador
 * de nota clínica.
 *
 * Deliberadamente NO se llama "Gemini", igual que el puerto de facturación no
 * se llama "Facturapi": el proveedor es un detalle de infraestructura que se
 * cambia sin tocar el dominio. Lo que el dominio promete es "de este audio
 * salen estos campos", y eso no depende de quién corra el modelo.
 */
export interface AsistenteClinicoIaPort {
  extraer(req: ExtraccionClinicaRequest): Promise<ExtraccionClinicaResult>;
}

export const ASISTENTE_CLINICO_IA = Symbol('ASISTENTE_CLINICO_IA');
