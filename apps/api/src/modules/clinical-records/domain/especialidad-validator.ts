import type { NotaEvolucionContent } from '@healthflow/shared-types';
import { evaluarEsquema, rutasDeErrores, validarCierre } from './motor-reglas';

/**
 * Validador de cierre de nota, en dos capas:
 *
 *   1. NOM-004 — la base legal, común a toda especialidad.
 *   2. Los campos que el perfil de la especialidad marque como obligatorios.
 *      Para odontología esto materializa la NOM-013-SSA2-2015, que exige
 *      registrar el tratamiento de cada sesión y las piezas intervenidas.
 *
 * Hoy es una fachada del motor de reglas (`motor-reglas.ts`), que concentra
 * la lógica; se conserva porque su contrato —la lista de rutas faltantes— es
 * el que consume la pantalla de consulta.
 *
 * Degradado seguro: `perfilDe` nunca lanza y cae a 'general' ante una clave
 * desconocida. Si una especialidad se retira del catálogo, o la nota es
 * anterior a esta función, el médico debe poder firmar cumpliendo la base
 * NOM-004. Un cambio de configuración jamás puede dejar una nota clínica
 * atrapada sin poder cerrarse.
 *
 * Devuelve la lista de campos faltantes; vacía = la nota puede cerrarse.
 */
export class EspecialidadValidator {
  static validar(content: NotaEvolucionContent): string[] {
    return rutasDeErrores(validarCierre(content, evaluarEsquema(content)));
  }
}
