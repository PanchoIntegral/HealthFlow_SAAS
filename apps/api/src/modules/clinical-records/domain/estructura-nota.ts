import {
  ADHERENCIAS,
  CAMBIOS_MEDICAMENTO,
  ESTADOS_NO_CAPTURADO,
  ESTADOS_PROBLEMA,
  TIPOS_ESTUDIO,
} from '@healthflow/shared-types';

/**
 * Límites de tamaño del contenido de una nota. Holgados a propósito: están
 * para que un cliente roto o malicioso no guarde megas de basura dentro de un
 * expediente que no se puede borrar, no para recortarle texto a un médico.
 */
export const LIMITES_NOTA = {
  textoRico: 100_000,
  textoCorto: 2_000,
  motivo: 500,
  signoVital: 20,
  cie10: 10,
  diagnosticos: 50,
  clavesExtension: 200,
  valorExtension: 50_000,
  itemsLista: 100,
  entradasRiesgo: 30,
  id: 64,
} as const;

/**
 * Valida la FORMA del contenido de una nota que llega del cliente (o de la
 * IA). No decide qué es clínicamente obligatorio —eso es del validador de
 * cierre—; sólo que cada campo tenga el tipo, el catálogo y el tamaño que
 * promete `NotaEvolucionContent`.
 *
 * Devuelve las RUTAS inválidas, nunca los valores: el resultado viaja en la
 * respuesta HTTP y a los logs, y ahí no puede ir contenido clínico.
 *
 * Tolerante con lo que no conoce: una clave extra se ignora en vez de
 * rechazarse, porque el editor también manda estado de UI y una nota vieja
 * reabierta no debe volverse imposible de guardar.
 */
export function validarEstructuraNota(contenido: unknown): string[] {
  const errores: string[] = [];
  if (!esObjeto(contenido)) return ['contenido'];
  const c = contenido;

  for (const campo of [
    'padecimientoActual',
    'planTerapeutico',
    'antecedentesHeredofamiliares',
    'antecedentesPersonalesPatologicos',
    'antecedentesPersonalesNoPatologicos',
  ]) {
    textoOpcional(c[campo], campo, LIMITES_NOTA.textoRico, errores);
  }
  if (c.motivoConsulta !== undefined && !textoValido(c.motivoConsulta, LIMITES_NOTA.id)) {
    errores.push('motivoConsulta');
  }
  textoOpcional(c.motivoOmisionSignosVitales, 'motivoOmisionSignosVitales', LIMITES_NOTA.motivo, errores);
  if (c.signosVitalesOmitidos !== undefined && typeof c.signosVitalesOmitidos !== 'boolean') {
    errores.push('signosVitalesOmitidos');
  }

  if (c.exploracionFisica !== undefined) {
    if (!esObjeto(c.exploracionFisica)) {
      errores.push('exploracionFisica');
    } else {
      const ef = c.exploracionFisica;
      textoOpcional(ef.hallazgos, 'exploracionFisica.hallazgos', LIMITES_NOTA.textoRico, errores);
      if (ef.signosVitales !== undefined) {
        if (!esObjeto(ef.signosVitales)) {
          errores.push('signosVitales');
        } else {
          for (const [k, v] of Object.entries(ef.signosVitales)) {
            const valido =
              v === null ||
              (typeof v === 'string' && v.length <= LIMITES_NOTA.signoVital) ||
              (typeof v === 'number' && Number.isFinite(v));
            if (!valido) errores.push(`signosVitales.${k}`);
          }
        }
      }
    }
  }

  if (c.diagnosticos !== undefined) {
    if (!Array.isArray(c.diagnosticos) || c.diagnosticos.length > LIMITES_NOTA.diagnosticos) {
      errores.push('diagnosticos');
    } else {
      c.diagnosticos.forEach((d, i) => {
        if (
          !esObjeto(d) ||
          !textoValido(d.cie10, LIMITES_NOTA.cie10) ||
          !textoValido(d.descripcion, LIMITES_NOTA.textoCorto)
        ) {
          errores.push(`diagnosticos.${i}`);
        }
      });
    }
  }

  if (c.extension !== undefined) {
    if (!esObjeto(c.extension) || Object.keys(c.extension).length > LIMITES_NOTA.clavesExtension) {
      errores.push('extension');
    } else {
      for (const [k, v] of Object.entries(c.extension)) {
        const valido =
          v === null ||
          (typeof v === 'string' && v.length <= LIMITES_NOTA.valorExtension) ||
          (typeof v === 'number' && Number.isFinite(v));
        if (!valido || k.length > LIMITES_NOTA.id) errores.push(`extension.${k.slice(0, LIMITES_NOTA.id)}`);
      }
    }
  }

  if (c.noCapturado !== undefined) {
    if (!esObjeto(c.noCapturado) || Object.keys(c.noCapturado).length > LIMITES_NOTA.clavesExtension) {
      errores.push('noCapturado');
    } else {
      for (const [ruta, dato] of Object.entries(c.noCapturado)) {
        const rutaSegura = ruta.slice(0, LIMITES_NOTA.id * 2);
        if (
          ruta.length > LIMITES_NOTA.id * 2 ||
          !esObjeto(dato) ||
          !enCatalogo(dato.estado, ESTADOS_NO_CAPTURADO) ||
          (dato.motivo !== undefined && !textoValido(dato.motivo, LIMITES_NOTA.motivo))
        ) {
          errores.push(`noCapturado.${rutaSegura}`);
        }
      }
    }
  }

  if (c.bloques !== undefined) validarBloques(c.bloques, errores);

  return errores;
}

function validarBloques(bloques: unknown, errores: string[]): void {
  if (!esObjeto(bloques)) {
    errores.push('bloques');
    return;
  }
  const t = LIMITES_NOTA.textoCorto;

  lista(bloques.problemas, 'bloques.problemas', ['sin_problemas_activos'], errores, (p) =>
    textoValido(p.id, LIMITES_NOTA.id) &&
    textoValido(p.descripcion, t) &&
    enCatalogo(p.estado, ESTADOS_PROBLEMA) &&
    opcionales(p, ['cie10', 'evidencia', 'objetivo', 'plan'], t),
  );

  lista(
    bloques.medicamentos,
    'bloques.medicamentos',
    ['sin_medicamentos', 'no_fue_posible_conciliar'],
    errores,
    (m) =>
      textoValido(m.id, LIMITES_NOTA.id) &&
      textoValido(m.nombre, t) &&
      enCatalogo(m.cambio, CAMBIOS_MEDICAMENTO) &&
      (m.adherencia === undefined || enCatalogo(m.adherencia, ADHERENCIAS)) &&
      opcionales(
        m,
        ['indicacion', 'dosis', 'via', 'frecuencia', 'tolerancia', 'contraindicaciones', 'monitoreo', 'razonCambio'],
        t,
      ),
  );

  lista(bloques.estudios, 'bloques.estudios', [], errores, (e) =>
    textoValido(e.id, LIMITES_NOTA.id) &&
    textoValido(e.nombre, t) &&
    enCatalogo(e.tipo, TIPOS_ESTUDIO) &&
    (e.valorNumerico === undefined || (typeof e.valorNumerico === 'number' && Number.isFinite(e.valorNumerico))) &&
    (e.solicitado === undefined || typeof e.solicitado === 'boolean') &&
    (e.fecha === undefined || esFecha(e.fecha)) &&
    opcionales(e, ['fuente', 'resultado', 'unidad', 'interpretacion', 'accion', 'referenciaArchivo'], t),
  );

  if (bloques.seguimiento !== undefined) {
    const s = bloques.seguimiento;
    if (
      !esObjeto(s) ||
      (s.declaracion !== undefined && s.declaracion !== 'seguimiento_no_requerido') ||
      (s.fecha !== undefined && !esFecha(s.fecha)) ||
      !opcionales(s, ['motivo', 'plazo', 'signosAlarma', 'referencia'], t)
    ) {
      errores.push('bloques.seguimiento');
    }
  }

  if (bloques.riesgoCv !== undefined) {
    if (!Array.isArray(bloques.riesgoCv) || bloques.riesgoCv.length > LIMITES_NOTA.itemsLista) {
      errores.push('bloques.riesgoCv');
    } else {
      bloques.riesgoCv.forEach((r, i) => {
        const valido =
          esObjeto(r) &&
          textoValido(r.algoritmo, t) &&
          textoValido(r.version, t) &&
          esFecha(r.fecha) &&
          textoValido(r.unidad, t) &&
          (textoValido(r.resultado, t) || (typeof r.resultado === 'number' && Number.isFinite(r.resultado))) &&
          Array.isArray(r.entradas) &&
          r.entradas.length <= LIMITES_NOTA.entradasRiesgo &&
          r.entradas.every(
            (e) =>
              esObjeto(e) &&
              textoValido(e.clave, t) &&
              (textoValido(e.valor, t) || (typeof e.valor === 'number' && Number.isFinite(e.valor))) &&
              opcionales(e, ['unidad'], t),
          );
        if (!valido) errores.push(`bloques.riesgoCv.${i}`);
      });
    }
  }

  if (bloques.pes !== undefined) {
    if (!Array.isArray(bloques.pes) || bloques.pes.length > LIMITES_NOTA.itemsLista) {
      errores.push('bloques.pes');
    } else {
      bloques.pes.forEach((p, i) => {
        if (
          !esObjeto(p) ||
          !textoValido(p.problema, t) ||
          !textoValido(p.etiologia, t) ||
          !textoValido(p.signosSintomas, t)
        ) {
          errores.push(`bloques.pes.${i}`);
        }
      });
    }
  }

  if (bloques.alergiasVerificadasEn !== undefined && !esFecha(bloques.alergiasVerificadasEn)) {
    errores.push('bloques.alergiasVerificadasEn');
  }
}

/** Valida una ListaEstructurada: items acotados y declaración del catálogo del bloque. */
function lista(
  valor: unknown,
  ruta: string,
  declaraciones: readonly string[],
  errores: string[],
  itemValido: (item: Record<string, unknown>) => boolean,
): void {
  if (valor === undefined) return;
  if (
    !esObjeto(valor) ||
    !Array.isArray(valor.items) ||
    valor.items.length > LIMITES_NOTA.itemsLista ||
    (valor.declaracion !== undefined && !enCatalogo(valor.declaracion, declaraciones)) ||
    (valor.motivo !== undefined && !textoValido(valor.motivo, LIMITES_NOTA.motivo))
  ) {
    errores.push(ruta);
    return;
  }
  valor.items.forEach((item, i) => {
    if (!esObjeto(item) || !itemValido(item)) errores.push(`${ruta}.${i}`);
  });
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function textoValido(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length <= max;
}

function textoOpcional(v: unknown, ruta: string, max: number, errores: string[]): void {
  if (v !== undefined && v !== null && !textoValido(v, max)) errores.push(ruta);
}

/** Todas las claves dadas, si vienen, son texto dentro del límite. */
function opcionales(obj: Record<string, unknown>, claves: readonly string[], max: number): boolean {
  return claves.every((k) => obj[k] === undefined || textoValido(obj[k], max));
}

function enCatalogo(v: unknown, catalogo: readonly string[]): boolean {
  return typeof v === 'string' && catalogo.includes(v);
}

/** Fecha ISO (YYYY-MM-DD, con hora opcional) que Date sabe interpretar. */
function esFecha(v: unknown): boolean {
  return (
    typeof v === 'string' &&
    /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) &&
    !Number.isNaN(Date.parse(v))
  );
}
