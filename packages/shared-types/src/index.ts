/**
 * Contratos compartidos entre `apps/web` (Next.js) y `apps/api` (NestJS).
 * Definir la forma de las entidades UNA sola vez: si algo se desincroniza
 * entre frontend y backend, TypeScript marca el error en ambos lados.
 */

// NOTA: el catálogo de especialidades está al FINAL de este archivo, y vive
// aquí en vez de en su propio módulo por una razón concreta: el paquete es
// ESM y se consume como TypeScript sin compilar. Un `export * from
// './especialidades.js'` obliga a TypeScript a pedir la extensión .js, pero
// Node la resuelve literalmente y ese archivo no existe (solo el .ts) — la API
// no arrancaba. Sin imports relativos, el paquete funciona igual para la API
// (CommonJS), las dos apps web (bundler) y Node en runtime.

// ── Roles y RBAC ─────────────────────────────────────────────────
export const USER_ROLES = ['medico', 'asistente', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

// ── Máquina de estados de la cita ────────────────────────────────
export const APPOINTMENT_STATUSES = [
  'agendada',
  'en_espera',
  'en_consulta',
  'finalizada',
  'cancelada',
  'no_asistio',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

// ── Entidades ────────────────────────────────────────────────────
/**
 * Sexo del paciente (RIS art. 65: va en el recetario junto con nombre y edad).
 *
 * `null` en la columna y 'no_especificado' NO son lo mismo, y la diferencia es
 * la que hace útil al dato: null = nunca se preguntó, y es el caso que la UI
 * persigue antes de emitir una receta; 'no_especificado' = se preguntó y el
 * paciente decidió no declararlo, y sí permite emitir. Mismo criterio que
 * `sinAlergiasConocidas`, que existe para separar "no tiene" de "no sabemos".
 */
export const SEXOS_PACIENTE = ['masculino', 'femenino', 'no_especificado'] as const;
export type SexoPaciente = (typeof SEXOS_PACIENTE)[number];

export const ETIQUETAS_SEXO: Record<SexoPaciente, string> = {
  masculino: 'Masculino',
  femenino: 'Femenino',
  no_especificado: 'No especificado',
};

export interface Patient {
  id: string;
  tenantId: string;
  nombre: string;
  fechaNacimiento: string; // ISO date (YYYY-MM-DD)
  sexo: SexoPaciente | null;
  curp: string | null;
  telefono: string | null;
}

/** Datos para dar de alta un paciente (el tenant lo asigna el backend). */
export interface CreatePatientRequest {
  nombre: string;
  fechaNacimiento: string; // ISO date (YYYY-MM-DD)
  sexo?: SexoPaciente | null;
  curp?: string | null;
  telefono?: string | null;
}

// ── Alergias y antecedentes del paciente ─────────────────────────
// Viven en el PACIENTE, no en la nota: son permanentes y deben verse en cada
// consulta, no solo en aquella donde alguien los tecleó.

export const TIPOS_ALERGIA = ['medicamento', 'material', 'alimento', 'otro'] as const;
export type TipoAlergia = (typeof TIPOS_ALERGIA)[number];

export const SEVERIDADES_ALERGIA = ['leve', 'moderada', 'grave'] as const;
export type SeveridadAlergia = (typeof SEVERIDADES_ALERGIA)[number];

export interface Alergia {
  sustancia: string;
  tipo: TipoAlergia;
  severidad: SeveridadAlergia;
  notas?: string;
}

/**
 * Antecedente que CAMBIA la conducta clínica en consulta. No es una etiqueta
 * decorativa: cada uno trae la conducta que dispara, porque el valor no está en
 * saber que el paciente toma anticoagulantes, sino en recordar qué hacer al
 * respecto justo antes de intervenir.
 */
export interface BanderaClinica {
  key: string;
  label: string;
  /** Qué implica en la consulta. Se muestra junto a la alerta. */
  conducta: string;
  /** true = riesgo de daño grave; se pinta en rojo, no en ámbar. */
  critica?: boolean;
}

export const BANDERAS_CLINICAS: readonly BanderaClinica[] = [
  {
    key: 'anticoagulantes',
    label: 'Toma anticoagulantes',
    conducta:
      'Riesgo hemorrágico. Medir INR 72 h antes de cirugía; en rango terapéutico NO se suspende el anticoagulante de rutina.',
    critica: true,
  },
  {
    key: 'bifosfonatos',
    label: 'Toma o tomó bifosfonatos',
    conducta:
      'Riesgo de osteonecrosis de los maxilares tras extracción, implante o cirugía. Valorar alternativas conservadoras; los bifosfonatos intravenosos son el escenario de mayor riesgo.',
    critica: true,
  },
  {
    key: 'profilaxis_endocarditis',
    label: 'Prótesis valvular o cardiopatía de alto riesgo',
    conducta:
      'Requiere profilaxis antibiótica antes de procedimientos que sangren: amoxicilina 2 g VO, 30–60 min antes.',
    critica: true,
  },
  {
    key: 'inmunosupresion',
    label: 'Inmunosupresión',
    conducta: 'Mayor riesgo de infección y cicatrización lenta. Valorar cobertura antibiótica.',
    critica: true,
  },
  {
    key: 'hipertension',
    label: 'Hipertensión arterial',
    conducta:
      'Verificar T/A antes de infiltrar. Cuidado con el anestésico con vasoconstrictor si no está controlada.',
  },
  {
    key: 'diabetes',
    label: 'Diabetes',
    conducta: 'Cicatrización lenta y mayor riesgo de infección. Preferir citas matutinas.',
  },
  {
    key: 'embarazo',
    label: 'Embarazo',
    conducta:
      'Evitar radiografías salvo urgencia y con protección. Revisar la categoría de riesgo de todo fármaco.',
  },
  {
    key: 'marcapasos',
    label: 'Marcapasos o dispositivo cardiaco',
    conducta: 'Precaución con ultrasonido, electrobisturí y aparatología electromagnética.',
  },
  { key: 'epilepsia', label: 'Epilepsia', conducta: 'Riesgo de crisis en el sillón. Sesiones cortas y sin estrés.' },
  { key: 'asma', label: 'Asma', conducta: 'Pedir que traiga su inhalador. Evitar desencadenantes.' },
] as const;

// ── Odontograma (nomenclatura FDI) ───────────────────────────────
//
// La FDI numera cada pieza con DOS dígitos: el primero es el cuadrante y el
// segundo la posición dentro de él, contando desde la línea media hacia atrás.
//   Permanentes: cuadrantes 1–4 (11–18, 21–28, 31–38, 41–48)
//   Temporales:  cuadrantes 5–8 (51–55, 61–65, 71–75, 81–85)
// Es el estándar internacional y el que espera cualquier dentista.

export const CUADRANTES_PERMANENTES = [1, 2, 3, 4] as const;
export const CUADRANTES_TEMPORALES = [5, 6, 7, 8] as const;

/** Caras de un diente. La oclusal/incisal no existe en las raíces, pero se
 *  modela igual para todos: es el vocabulario con el que se registra. */
export const CARAS_DIENTE = ['vestibular', 'palatino', 'mesial', 'distal', 'oclusal'] as const;
export type CaraDiente = (typeof CARAS_DIENTE)[number];

export const ETIQUETA_CARA: Record<CaraDiente, string> = {
  vestibular: 'Vestibular',
  palatino: 'Palatino / lingual',
  mesial: 'Mesial',
  distal: 'Distal',
  oclusal: 'Oclusal / incisal',
};

export interface EstadoDental {
  key: string;
  label: string;
  /** Color de relleno en el mapa. */
  color: string;
  /** true = se aplica al diente completo, no a una cara suelta. */
  piezaCompleta?: boolean;
  /**
   * true = es un hallazgo que PIDE tratamiento, así que puede convertirse en
   * partida de presupuesto. Distingue lo que hay que hacer (caries, fractura)
   * de lo que ya está hecho (obturación, corona, implante): presupuestar una
   * obturación existente sería cobrar dos veces por el mismo trabajo.
   */
  requiereTratamiento?: boolean;
}

/**
 * Estados registrables. `sano` no está en la lista a propósito: es la ausencia
 * de registro, y guardarlo explícitamente llenaría el jsonb de ruido.
 */
export const ESTADOS_DENTALES: readonly EstadoDental[] = [
  { key: 'caries', label: 'Caries', color: '#dc2626', requiereTratamiento: true },
  { key: 'obturado', label: 'Obturado', color: '#2563eb' },
  { key: 'fracturado', label: 'Fracturado', color: '#f59e0b', requiereTratamiento: true },
  { key: 'ausente', label: 'Ausente', color: '#94a3b8', piezaCompleta: true },
  {
    key: 'extraccion_indicada',
    label: 'Extracción indicada',
    color: '#b91c1c',
    piezaCompleta: true,
    requiereTratamiento: true,
  },
  { key: 'corona', label: 'Corona', color: '#7c3aed', piezaCompleta: true },
  { key: 'endodoncia', label: 'Endodoncia', color: '#db2777', piezaCompleta: true },
  { key: 'implante', label: 'Implante', color: '#0f766e', piezaCompleta: true },
  { key: 'sellador', label: 'Sellador', color: '#059669' },
  { key: 'protesis', label: 'Prótesis', color: '#4338ca', piezaCompleta: true },
] as const;

export function estadoDentalPorKey(key: string): EstadoDental | undefined {
  return ESTADOS_DENTALES.find((e) => e.key === key);
}

/**
 * Marca sobre una pieza. `cara` ausente = aplica al diente completo (los
 * estados con `piezaCompleta`, como ausente o corona).
 */
export interface MarcaDental {
  /** Pieza en notación FDI: '16', '21', '51'… */
  pieza: string;
  cara?: CaraDiente;
  estado: string;
  nota?: string;
}

/**
 * Odontograma completo. Es una LISTA de marcas y no una matriz diente×cara
 * porque la inmensa mayoría de las piezas no tiene nada que registrar: una
 * lista pesa lo que el hallazgo real y se lee igual de fácil.
 */
export interface Odontograma {
  /** 'permanente' | 'temporal' | 'mixta' — qué dentición se está registrando. */
  denticion: 'permanente' | 'temporal' | 'mixta';
  marcas: MarcaDental[];
}

export const ODONTOGRAMA_VACIO: Odontograma = { denticion: 'permanente', marcas: [] };

/**
 * Convierte los hallazgos del odontograma en partidas de presupuesto.
 *
 * Es el puente entre lo clínico y lo comercial: el dentista marca caries en el
 * 16 y de ahí sale la partida a cotizar, sin recapturar nada.
 *
 * Agrupa por (estado, pieza) y no por cara: dos caries en dos caras del mismo
 * diente son UN tratamiento, no dos. Y solo considera los estados que piden
 * tratamiento — presupuestar una obturación que ya existe sería cobrar dos
 * veces por el mismo trabajo.
 *
 * El precio queda en cero a propósito: lo pone el dentista, no el software.
 */
export function partidasDesdeOdontograma(odontograma: Odontograma): NuevaPartida[] {
  const tratables = new Set(
    ESTADOS_DENTALES.filter((e) => e.requiereTratamiento).map((e) => e.key),
  );

  const vistos = new Set<string>();
  const partidas: NuevaPartida[] = [];

  for (const marca of odontograma.marcas) {
    if (!tratables.has(marca.estado)) continue;
    const clave = `${marca.estado}|${marca.pieza}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);

    partidas.push({
      descripcion: estadoDentalPorKey(marca.estado)?.label ?? marca.estado,
      piezas: [marca.pieza],
      fase: 1,
      cantidad: 1,
      valorUnitarioCentavos: 0,
    });
  }

  // Orden natural por número de pieza, para que la cotización se lea como se
  // recorre la boca y no en el orden en que se fue marcando.
  return partidas.sort((a, b) => (a.piezas?.[0] ?? '').localeCompare(b.piezas?.[0] ?? ''));
}

/** Piezas de un cuadrante, de la línea media hacia atrás. */
export function piezasDeCuadrante(cuadrante: number): string[] {
  const total = cuadrante <= 4 ? 8 : 5; // los temporales solo llegan a 5
  return Array.from({ length: total }, (_, i) => `${cuadrante}${i + 1}`);
}

// ── Podograma (mapa podológico) ──────────────────────────────────
//
// El equivalente podológico del odontograma: dónde está cada lesión, en qué
// pie y en qué vista. Sustituye la silueta de pies que la podóloga marca a
// mano e imprime para engrapar al expediente.
//
// Mismas dos decisiones que allá, y por las mismas razones:
//   1. Es una LISTA DE MARCAS y no una matriz zona×hallazgo. Un pie sano son
//      cero marcas y la consulta típica son dos o tres; una matriz de 30 zonas
//      × 2 pies guardaría 60 casillas vacías en cada nota.
//   2. Las claves de zona y de hallazgo son ESTABLES y no se renombran nunca:
//      quedan escritas en el jsonb de notas ya firmadas, que por NOM-004 son
//      inmutables y deben poder leerse para siempre.

export const VISTAS_PIE = ['plantar', 'dorsal'] as const;
export type VistaPie = (typeof VISTAS_PIE)[number];

export const ETIQUETA_VISTA: Record<VistaPie, string> = {
  plantar: 'Planta',
  dorsal: 'Dorso',
};

export type LadoPie = 'izquierdo' | 'derecho';

export const ETIQUETA_LADO: Record<LadoPie, string> = {
  izquierdo: 'Izquierdo',
  derecho: 'Derecho',
};

/**
 * Familias de hallazgo. Solo agrupan la paleta en pantalla: 32 botones en fila
 * son inusables, y el podólogo busca por familia ("algo de uñas") antes que
 * por nombre exacto.
 */
export const CATEGORIAS_HALLAZGO = ['ungueal', 'cutaneo', 'estructural', 'vascular'] as const;
export type CategoriaHallazgo = (typeof CATEGORIAS_HALLAZGO)[number];

export const ETIQUETA_CATEGORIA: Record<CategoriaHallazgo, string> = {
  ungueal: 'Uñas',
  cutaneo: 'Piel',
  estructural: 'Estructura',
  vascular: 'Vascular y color',
};

export interface HallazgoPodologico {
  key: string;
  label: string;
  categoria: CategoriaHallazgo;
  /** Color de relleno en el mapa. */
  color: string;
  /**
   * Solo puede marcarse sobre una lámina ungueal. Es el análogo exacto de
   * `piezaCompleta` en el odontograma: impide registrar una onicomicosis en el
   * talón, que no es un dato raro sino un dato imposible.
   */
  soloUngueal?: boolean;
}

/**
 * Catálogo de hallazgos, tomado de la lista de EXPLORACIÓN FÍSICA VISUAL de la
 * historia clínica en papel. "Sano" no está a propósito: es la ausencia de
 * marca, igual que en el odontograma.
 */
export const HALLAZGOS_PODOLOGICOS: readonly HallazgoPodologico[] = [
  // ── Uñas ──
  { key: 'onicomicosis', label: 'Onicomicosis', categoria: 'ungueal', color: '#a16207', soloUngueal: true },
  { key: 'onicocriptosis', label: 'Onicocriptosis (uña encarnada)', categoria: 'ungueal', color: '#dc2626', soloUngueal: true },
  { key: 'onicogrifosis', label: 'Onicogrifosis', categoria: 'ungueal', color: '#92400e', soloUngueal: true },
  { key: 'onicolisis', label: 'Onicólisis', categoria: 'ungueal', color: '#b45309', soloUngueal: true },
  { key: 'onicomadesis', label: 'Onicomadesis', categoria: 'ungueal', color: '#c2410c', soloUngueal: true },
  { key: 'onicodistrofia', label: 'Onicodistrofia', categoria: 'ungueal', color: '#78350f', soloUngueal: true },
  { key: 'onicoquizia', label: 'Onicoquizia', categoria: 'ungueal', color: '#a3620d', soloUngueal: true },
  { key: 'paroniquia', label: 'Paroniquia', categoria: 'ungueal', color: '#e11d48', soloUngueal: true },
  { key: 'oniquia', label: 'Oniquia', categoria: 'ungueal', color: '#9f1239', soloUngueal: true },
  { key: 'leuconiquia', label: 'Leuconiquia', categoria: 'ungueal', color: '#64748b', soloUngueal: true },
  { key: 'melanoniquia', label: 'Melanoniquia', categoria: 'ungueal', color: '#1e293b', soloUngueal: true },
  { key: 'coiloniquia', label: 'Coiloniquia', categoria: 'ungueal', color: '#0369a1', soloUngueal: true },
  { key: 'una_dedal', label: 'Uña de dedal', categoria: 'ungueal', color: '#0e7490', soloUngueal: true },
  { key: 'una_mitad_mitad', label: 'Uña de mitad y mitad', categoria: 'ungueal', color: '#155e75', soloUngueal: true },
  { key: 'unas_hipocraticas', label: 'Uñas hipocráticas', categoria: 'ungueal', color: '#7e22ce', soloUngueal: true },

  // ── Piel ──
  { key: 'hiperqueratosis', label: 'Hiperqueratosis', categoria: 'cutaneo', color: '#f59e0b' },
  { key: 'heloma', label: 'Heloma (callo)', categoria: 'cutaneo', color: '#d97706' },
  { key: 'ulcera', label: 'Úlcera', categoria: 'cutaneo', color: '#b91c1c' },
  { key: 'micosis_plantar', label: 'Micosis plantar', categoria: 'cutaneo', color: '#65a30d' },
  { key: 'micosis_interdigital', label: 'Micosis interdigital', categoria: 'cutaneo', color: '#4d7c0f' },
  { key: 'verruga', label: 'Verruga plantar', categoria: 'cutaneo', color: '#16a34a' },
  { key: 'dermatitis', label: 'Dermatitis', categoria: 'cutaneo', color: '#ec4899' },
  { key: 'descamacion', label: 'Descamación', categoria: 'cutaneo', color: '#f472b6' },
  { key: 'fisura', label: 'Fisura / grieta', categoria: 'cutaneo', color: '#be123c' },
  { key: 'tatuaje', label: 'Tatuaje', categoria: 'cutaneo', color: '#334155' },

  // ── Estructura ──
  { key: 'hallux_valgus', label: 'Hallux valgus (juanete)', categoria: 'estructural', color: '#7c3aed' },
  { key: 'juanete_sastre', label: 'Juanete de sastre (quintovaro)', categoria: 'estructural', color: '#6d28d9' },
  { key: 'dedo_garra', label: 'Dedo en garra / martillo', categoria: 'estructural', color: '#5b21b6' },
  { key: 'alteracion_osea', label: 'Alteración ósea', categoria: 'estructural', color: '#4c1d95' },
  { key: 'polidactilia', label: 'Polidactilia', categoria: 'estructural', color: '#8b5cf6' },
  { key: 'sindactilia', label: 'Sindactilia', categoria: 'estructural', color: '#a78bfa' },
  { key: 'espolon', label: 'Espolón calcáneo', categoria: 'estructural', color: '#4338ca' },

  // ── Vascular y color ──
  { key: 'palidez', label: 'Palidez', categoria: 'vascular', color: '#cbd5e1' },
  { key: 'eritema', label: 'Eritema', categoria: 'vascular', color: '#ef4444' },
  { key: 'hematoma', label: 'Hematoma', categoria: 'vascular', color: '#6b21a8' },
  { key: 'cianosis', label: 'Cianosis', categoria: 'vascular', color: '#2563eb' },
  { key: 'edema', label: 'Edema', categoria: 'vascular', color: '#38bdf8' },
] as const;

export function hallazgoPodologicoPorKey(key: string): HallazgoPodologico | undefined {
  return HALLAZGOS_PODOLOGICOS.find((h) => h.key === key);
}

/**
 * Zona anatómica marcable.
 *
 * Todas las zonas son elipses en un lienzo de 100×250 que representa UN pie
 * con el hallux a la IZQUIERDA del lienzo. El componente refleja ese dibujo
 * según pie y vista, así que la geometría se escribe una sola vez.
 */
export interface ZonaPie {
  key: string;
  label: string;
  vista: VistaPie;
  /** Lámina ungueal: solo admite hallazgos con `soloUngueal`. */
  ungueal?: boolean;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/**
 * Mapa de zonas. Las claves llevan prefijo de vista (`p_` / `d_`) porque el
 * mismo dedo se marca distinto por la planta que por el dorso: una
 * hiperqueratosis pulpejo-plantar y una onicomicosis dorsal del mismo hallux
 * son dos hallazgos, no uno.
 */
export const ZONAS_PIE: readonly ZonaPie[] = [
  // ── Vista plantar ──
  { key: 'p_dedo_1', label: 'Pulpejo 1.º dedo (hallux)', vista: 'plantar', cx: 20, cy: 36, rx: 13, ry: 16 },
  { key: 'p_dedo_2', label: 'Pulpejo 2.º dedo', vista: 'plantar', cx: 42, cy: 30, rx: 8, ry: 12 },
  { key: 'p_dedo_3', label: 'Pulpejo 3.er dedo', vista: 'plantar', cx: 57, cy: 33, rx: 7.5, ry: 11 },
  { key: 'p_dedo_4', label: 'Pulpejo 4.º dedo', vista: 'plantar', cx: 70, cy: 39, rx: 7, ry: 10 },
  { key: 'p_dedo_5', label: 'Pulpejo 5.º dedo', vista: 'plantar', cx: 82, cy: 48, rx: 6.5, ry: 9 },

  { key: 'p_interdigital_1', label: '1.er espacio interdigital', vista: 'plantar', cx: 31, cy: 54, rx: 5, ry: 6 },
  { key: 'p_interdigital_2', label: '2.º espacio interdigital', vista: 'plantar', cx: 50, cy: 50, rx: 4.5, ry: 6 },
  { key: 'p_interdigital_3', label: '3.er espacio interdigital', vista: 'plantar', cx: 64, cy: 54, rx: 4.5, ry: 6 },
  { key: 'p_interdigital_4', label: '4.º espacio interdigital', vista: 'plantar', cx: 77, cy: 62, rx: 4.5, ry: 6 },

  { key: 'p_meta_1', label: '1.ª cabeza metatarsal', vista: 'plantar', cx: 24, cy: 78, rx: 12, ry: 12 },
  { key: 'p_meta_2', label: '2.ª cabeza metatarsal', vista: 'plantar', cx: 45, cy: 72, rx: 9, ry: 11 },
  { key: 'p_meta_3', label: '3.ª cabeza metatarsal', vista: 'plantar', cx: 59, cy: 74, rx: 9, ry: 11 },
  { key: 'p_meta_4', label: '4.ª cabeza metatarsal', vista: 'plantar', cx: 71, cy: 79, rx: 9, ry: 11 },
  { key: 'p_meta_5', label: '5.ª cabeza metatarsal', vista: 'plantar', cx: 83, cy: 88, rx: 9, ry: 11 },

  { key: 'p_arco', label: 'Arco medial (bóveda plantar)', vista: 'plantar', cx: 34, cy: 136, rx: 17, ry: 30 },
  { key: 'p_borde_lateral', label: 'Borde lateral', vista: 'plantar', cx: 73, cy: 136, rx: 13, ry: 30 },
  { key: 'p_talon', label: 'Talón (calcáneo)', vista: 'plantar', cx: 52, cy: 198, rx: 26, ry: 31 },

  // ── Vista dorsal: uñas + dorso ──
  { key: 'd_una_1', label: 'Uña 1.er dedo (hallux)', vista: 'dorsal', ungueal: true, cx: 20, cy: 30, rx: 9, ry: 10 },
  { key: 'd_una_2', label: 'Uña 2.º dedo', vista: 'dorsal', ungueal: true, cx: 42, cy: 25, rx: 5.5, ry: 6.5 },
  { key: 'd_una_3', label: 'Uña 3.er dedo', vista: 'dorsal', ungueal: true, cx: 57, cy: 28, rx: 5, ry: 6 },
  { key: 'd_una_4', label: 'Uña 4.º dedo', vista: 'dorsal', ungueal: true, cx: 70, cy: 34, rx: 4.5, ry: 5.5 },
  { key: 'd_una_5', label: 'Uña 5.º dedo', vista: 'dorsal', ungueal: true, cx: 82, cy: 43, rx: 4, ry: 5 },

  { key: 'd_dedo_1', label: 'Dorso 1.er dedo', vista: 'dorsal', cx: 20, cy: 47, rx: 11, ry: 7 },
  { key: 'd_dedo_2', label: 'Dorso 2.º dedo', vista: 'dorsal', cx: 42, cy: 38, rx: 7, ry: 6 },
  { key: 'd_dedo_3', label: 'Dorso 3.er dedo', vista: 'dorsal', cx: 57, cy: 41, rx: 6.5, ry: 5.5 },
  { key: 'd_dedo_4', label: 'Dorso 4.º dedo', vista: 'dorsal', cx: 70, cy: 46, rx: 6, ry: 5 },
  { key: 'd_dedo_5', label: 'Dorso 5.º dedo', vista: 'dorsal', cx: 82, cy: 53, rx: 5.5, ry: 5 },

  { key: 'd_primera_afm', label: '1.ª articulación metatarsofalángica', vista: 'dorsal', cx: 24, cy: 80, rx: 13, ry: 13 },
  { key: 'd_quinta_afm', label: '5.ª articulación metatarsofalángica', vista: 'dorsal', cx: 83, cy: 90, rx: 11, ry: 12 },
  { key: 'd_dorso', label: 'Dorso del pie', vista: 'dorsal', cx: 54, cy: 140, rx: 26, ry: 40 },
  { key: 'd_tobillo', label: 'Tobillo y maléolos', vista: 'dorsal', cx: 52, cy: 202, rx: 25, ry: 26 },
] as const;

export function zonaPiePorKey(key: string): ZonaPie | undefined {
  return ZONAS_PIE.find((z) => z.key === key);
}

/** Marca sobre una zona de un pie. */
export interface MarcaPodologica {
  pie: LadoPie;
  /** Clave de ZONAS_PIE. La vista va implícita en la zona. */
  zona: string;
  /** Clave de HALLAZGOS_PODOLOGICOS. */
  hallazgo: string;
  nota?: string;
}

export interface Podograma {
  marcas: MarcaPodologica[];
}

export const PODOGRAMA_VACIO: Podograma = { marcas: [] };

/**
 * True si el hallazgo puede registrarse en esa zona.
 *
 * La regla es una sola y va en un lado: un hallazgo ungueal solo cabe en una
 * lámina ungueal. Vive aquí y no en el componente para que la API valide lo
 * mismo que la pantalla dibuja — si solo lo cuidara el frontend, una nota
 * llegada por la IA o por otro cliente podría guardar un imposible.
 */
export function hallazgoAplicaEnZona(hallazgoKey: string, zonaKey: string): boolean {
  const hallazgo = hallazgoPodologicoPorKey(hallazgoKey);
  const zona = zonaPiePorKey(zonaKey);
  if (!hallazgo || !zona) return false;
  return hallazgo.soloUngueal === true ? zona.ungueal === true : true;
}

/**
 * Resumen legible del podograma, agrupado por hallazgo.
 *
 * Existe para que la nota impresa y el timeline del paciente puedan mostrar lo
 * marcado SIN depender del dibujo: un expediente exportado a PDF o leído desde
 * otro sistema tiene que poder decir qué se encontró y dónde.
 */
export function resumirPodograma(podograma: Podograma): string[] {
  const porHallazgo = new Map<string, MarcaPodologica[]>();
  for (const m of podograma.marcas) {
    porHallazgo.set(m.hallazgo, [...(porHallazgo.get(m.hallazgo) ?? []), m]);
  }

  return [...porHallazgo].map(([key, marcas]) => {
    const label = hallazgoPodologicoPorKey(key)?.label ?? key;
    const sitios = marcas
      .map((m) => `${zonaPiePorKey(m.zona)?.label ?? m.zona} (${ETIQUETA_LADO[m.pie].toLowerCase()})`)
      .join(', ');
    return `${label}: ${sitios}`;
  });
}

// ── Mapa corporal (clínica de heridas y estomas) ──────────────────
//
// Las coordenadas se guardan normalizadas de 0 a 1000. Así la marca sigue
// apuntando al mismo sitio aunque el SVG se vea grande en escritorio, pequeño
// en teléfono o se renderice después en un documento impreso.

export const VISTAS_CORPORALES = ['anterior', 'posterior'] as const;
export type VistaCorporal = (typeof VISTAS_CORPORALES)[number];

export const ETIQUETA_VISTA_CORPORAL: Record<VistaCorporal, string> = {
  anterior: 'Vista anterior',
  posterior: 'Vista posterior',
};

export const TIPOS_MARCA_CORPORAL = [
  { key: 'herida', label: 'Herida', color: '#dc2626' },
  { key: 'lesion_presion', label: 'Lesión por presión', color: '#7c3aed' },
  { key: 'estoma', label: 'Estoma', color: '#0891b2' },
  { key: 'otro', label: 'Otro', color: '#d97706' },
] as const;

export type TipoMarcaCorporal = (typeof TIPOS_MARCA_CORPORAL)[number]['key'];

export function tipoMarcaCorporalPorKey(key: string) {
  return TIPOS_MARCA_CORPORAL.find((tipo) => tipo.key === key);
}

/** Un punto anatómico de una herida o estoma dentro de ESTA nota. */
export interface MarcaCorporal {
  /** Identidad estable: permite editar o retirar una marca sin depender del orden. */
  id: string;
  vista: VistaCorporal;
  /** Posición normalizada dentro del lienzo, en el intervalo cerrado 0–1000. */
  x: number;
  y: number;
  tipo: TipoMarcaCorporal;
  /** Precisión escrita: p. ej. "maléolo medial derecho". */
  descripcion?: string;
}

export interface MapaCorporal {
  marcas: MarcaCorporal[];
}

export const MAPA_CORPORAL_VACIO: MapaCorporal = { marcas: [] };

/** Rechaza coordenadas/catálogos adulterados recibidos de otro cliente. */
export function marcaCorporalValida(marca: MarcaCorporal | null | undefined): boolean {
  return (
    typeof marca === 'object' &&
    marca !== null &&
    typeof marca.id === 'string' &&
    marca.id.trim().length > 0 &&
    VISTAS_CORPORALES.includes(marca.vista) &&
    Number.isFinite(marca.x) &&
    marca.x >= 0 &&
    marca.x <= 1000 &&
    Number.isFinite(marca.y) &&
    marca.y >= 0 &&
    marca.y <= 1000 &&
    tipoMarcaCorporalPorKey(marca.tipo) !== undefined &&
    (marca.descripcion === undefined || typeof marca.descripcion === 'string')
  );
}

export function mapaCorporalValido(mapa: MapaCorporal | null | undefined): boolean {
  if (!mapa || !Array.isArray(mapa.marcas) || mapa.marcas.length === 0) return false;
  const ids = mapa.marcas.map((marca) => marca.id);
  return new Set(ids).size === ids.length && mapa.marcas.every(marcaCorporalValida);
}

/** Resumen textual para que el dato siga siendo legible sin depender del SVG. */
export function resumirMapaCorporal(mapa: MapaCorporal): string[] {
  return mapa.marcas.map((marca, indice) => {
    const tipo = tipoMarcaCorporalPorKey(marca.tipo)?.label ?? marca.tipo;
    const vista = ETIQUETA_VISTA_CORPORAL[marca.vista] ?? marca.vista;
    const sitio = marca.descripcion?.trim();
    return `${indice + 1}. ${tipo} · ${vista}${sitio ? ` · ${sitio}` : ''}`;
  });
}

export interface AntecedentesPaciente {
  /** Claves de BANDERAS_CLINICAS activas en este paciente. */
  banderas: string[];
  patologicos?: string;
  quirurgicos?: string;
  medicamentosActuales?: string;
  familiares?: string;
}

export const ANTECEDENTES_VACIOS: AntecedentesPaciente = { banderas: [] };

/** Antecedentes clínicos completos de un paciente. */
export interface HistorialPaciente {
  /**
   * Declaración EXPLÍCITA de que no tiene alergias conocidas. Existe porque
   * una lista vacía es ambigua —¿no tiene, o nadie preguntó?— y esa ambigüedad
   * es justo la que hace daño antes de infiltrar un anestésico.
   */
  sinAlergiasConocidas: boolean;
  alergias: Alergia[];
  antecedentes: AntecedentesPaciente;
  /**
   * Viaja con el historial, y no en una petición aparte, por la misma razón
   * que las alergias: es un dato PERMANENTE del paciente que la pantalla de
   * consulta necesita en el momento de prescribir (RIS art. 65), y ya se lee
   * aquí. null = nunca se capturó; es lo que el modal de receta pide antes de
   * emitir.
   */
  sexo: SexoPaciente | null;
}

export function banderaPorKey(key: string): BanderaClinica | undefined {
  return BANDERAS_CLINICAS.find((b) => b.key === key);
}

/**
 * Corrección de los datos de identificación del paciente.
 *
 * Deliberadamente NO incluye fecha de nacimiento ni CURP: la primera cambia la
 * edad impresa en cada receta ya emitida (que es un snapshot, no un JOIN) y la
 * segunda tiene control de duplicados propio. Corregir esos dos es un caso de
 * uso distinto, con sus reglas.
 */
export interface UpdatePatientRequest {
  nombre?: string;
  /** Cadena vacía = borrar el teléfono guardado, igual que las cédulas. */
  telefono?: string;
  /**
   * YYYY-MM-DD. Las recetas ya emitidas conservan la edad con la que se
   * imprimieron (snapshot congelado, ver 0028) — esto solo afecta el
   * expediente y las recetas futuras.
   */
  fechaNacimiento?: string;
}

/**
 * Por qué un paciente no se puede borrar. Lo devuelve el intento de borrado
 * cuando hay actividad clínica, para que la UI pueda decir exactamente qué
 * existe en vez de un "no se puede" sin explicación.
 */
export interface ActividadClinicaPaciente {
  notas: number;
  recetas: number;
  consentimientos: number;
  radiografias: number;
  presupuestos: number;
  facturas: number;
  citasAtendidas: number;
  ordenesPlantillas: number;
  /**
   * Receptor fiscal (RFC y razón social) capturado para facturarle. Cuenta
   * como actividad por dos razones: quien capturó datos fiscales no creó un
   * duplicado por error, y además `receptores_fiscales` referencia al paciente
   * con ON DELETE NO ACTION — sin contarlo, el borrado reventaría con un error
   * de llave foránea en vez de una explicación.
   */
  datosFiscales: number;
}

/** Resultado del buscador de pacientes. */
export interface PatientSummary {
  id: string;
  nombre: string;
  edad: number;
  sexo: SexoPaciente | null;
  curp: string | null;
  telefono: string | null;
}

/** Una PÁGINA del directorio/buscador de pacientes (GET /patients). */
export interface PatientDirectoryPage {
  pacientes: PatientSummary[];
  /**
   * Cursor opaco para pedir la página siguiente; null cuando ya no hay más.
   * No lo interpretes en el cliente: su formato es un detalle del servidor.
   */
  nextCursor: string | null;
  /**
   * Total de pacientes que cumplen el criterio, independiente de la paginación.
   *
   * Existe porque la cabecera dice "N pacientes en el directorio": mostrar ahí
   * el largo de la página anunciaría una clínica de 300 pacientes como de 25.
   */
  total: number;
}

export interface Appointment {
  id: string;
  tenantId: string;
  patientId: string;
  doctorId: string;
  inicioProgramado: string; // ISO datetime
  finProgramado: string; // ISO datetime
  estatus: AppointmentStatus;
  checkinAt: string | null;
  inicioReal: string | null;
  finReal: string | null;
}

/**
 * Vista enriquecida de una cita para la sala de espera: la cita + los datos
 * del paciente que la UI necesita mostrar en la tarjeta.
 */
export interface WaitingRoomEntry {
  appointmentId: string;
  patientId: string;
  patientNombre: string;
  patientEdad: number;
  estatus: AppointmentStatus;
  motivo: string | null;
  inicioProgramado: string;
  checkinAt: string | null;
}

// ── Eventos WebSocket (sala de espera en tiempo real) ────────────
export const WAITING_ROOM_EVENTS = {
  /**
   * El servidor emite esto cuando una cita del día en curso se crea o cambia
   * de estado. El cliente hace *upsert* de `entry` en su lista: una cita
   * recién agendada se da de alta, una existente se reemplaza.
   */
  APPOINTMENT_UPDATED: 'appointment.updated',
} as const;

export interface AppointmentUpdatedEvent {
  entry: WaitingRoomEntry;
  /** Estado anterior, o null si la cita se acaba de crear (alta). */
  previousStatus: AppointmentStatus | null;
}

// ── DTOs de API ──────────────────────────────────────────────────
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  user: {
    id: string;
    tenantId: string;
    nombre: string;
    rol: UserRole;
  };
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/** Perfil propio del usuario autenticado (GET /users/me). */
export interface UserProfile {
  id: string;
  nombre: string;
  rol: UserRole;
  /** Etiqueta libre mostrada en el selector de agenda (p.ej. "Cardiología intervencionista"). */
  especialidad: string | null;
  /** Clave del catálogo PERFILES: personaliza campos, etiquetas y signos vitales de la nota. */
  especialidadKey: EspecialidadKey;
  /**
   * Cédula profesional. NOM-004 exige que la nota lleve el nombre COMPLETO y la
   * cédula de quien la firma, así que este dato no es decorativo: es lo que se
   * estampa en la firma al cerrar. Si está vacío, la nota se firma sin cédula
   * y queda incompleta frente a la norma.
   */
  cedulaProfesional: string | null;
  /**
   * Título con el que firma sus documentos impresos ("Dr." / "Dra."). null =
   * sin título en el membrete, que es como se imprimieron todas las recetas
   * anteriores a este campo. Es del MÉDICO y no de la clínica: en el mismo
   * consultorio firman un doctor y una doctora.
   */
  titulo: TituloMedico | null;
  /**
   * Cédula de ESPECIALIDAD, distinta de la profesional: certifica la
   * especialidad concreta (podiatría, cardiología…), no el ejercicio general
   * de la medicina. Un médico puede tener la profesional sin esta. Solo se usa
   * hoy para el membrete de documentos impresos (orden de plantillas); NOM-004
   * no la exige para firmar, así que no participa en esa validación.
   */
  cedulaEspecialidad: string | null;
  /**
   * Institución que expidió el título profesional (RIS art. 64). Del MÉDICO y
   * no de la clínica —dos médicos del mismo consultorio pueden venir de
   * universidades distintas—, a diferencia de `direccionClinica`. Sin este
   * dato una receta impresa queda incompleta frente al artículo, así que
   * `RecetaValidator` lo exige al emitir; NOM-004 no lo pide para firmar una
   * nota, de modo que no participa en esa validación.
   */
  institucionTitulo: string | null;
  /**
   * '12h' (con AM/PM) o '24h'. Preferencia PERSONAL de cómo se muestra la hora
   * en el calendario, el dashboard, la sala de espera y el corte de caja —
   * distinta de `especialidadKey`: no afecta a nadie más que a quien la elige.
   * Default '24h' para cuentas nuevas.
   */
  formatoHora: '12h' | '24h';
  /**
   * Si la clínica tiene contratado el asistente de transcripción con IA. Viaja
   * con el perfil —y no en una petición aparte— porque la pantalla de consulta
   * ya lee el perfil al montar, y así el botón de grabar aparece sin un viaje
   * extra al servidor.
   */
  asistenteIaActivo: boolean;
  /**
   * Si la clínica ejerce odontología: hay al menos un usuario con
   * `especialidad_key = 'odontologia'`. Enciende lo que solo tiene sentido en
   * un consultorio dental —presupuestos por piezas, odontograma— y lo apaga
   * para el resto de las especialidades, que lo veían sin poder usarlo.
   *
   * Es del TENANT y no del usuario que mira a propósito: quien cobra suele ser
   * la asistente, cuyo `especialidad_key` es 'general'. Colgarlo del usuario le
   * escondería los presupuestos justo a quien los usa todo el día.
   */
  clinicaDental: boolean;
  /**
   * Dirección y teléfono de la clínica, para el membrete de documentos
   * impresos. Del TENANT, no del usuario — mismo criterio que `clinicaDental`:
   * viaja con el perfil porque es donde ya se lee al montar cualquier
   * pantalla, y así se evita una petición aparte solo para esto.
   */
  direccionClinica: string | null;
  telefonoClinica: string | null;
}

/**
 * Qué tan grave es la situación de pago de la clínica.
 *
 * Lo DERIVA el servidor (common/subscription/debe-restringir.ts) y el cliente
 * solo lo pinta: el umbral de la gracia es política de negocio y tenerlo en un
 * solo lado evita que el banner y el gating discrepen.
 *
 *  - `ok`          — al corriente (o sin suscripción: seeds y desarrollo).
 *  - `advertencia` — un cobro falló y corre la gracia. Todavía puede escribir.
 *  - `suspendida`  — gracia agotada: la cuenta está en SOLO LECTURA.
 */
export type AvisoSuscripcion = 'ok' | 'advertencia' | 'suspendida';

/** Estado de pago de la clínica, tal como lo consume la UI. Fechas en ISO. */
export interface SuscripcionEstadoView {
  aviso: AvisoSuscripcion;
  /** Hasta cuándo se tolera el impago. Solo viene con `aviso: 'advertencia'`. */
  graceUntil: string | null;
  /** Fin del periodo pagado, para "tu plan se renueva el …". */
  currentPeriodEnd: string | null;
}

/**
 * Tarjeta con la que se cobra la suscripción, tal como la reporta Stripe.
 *
 * Deliberadamente incompleta: marca, últimos 4 y vencimiento son lo único que
 * hace falta para que el titular reconozca SU tarjeta. El número completo
 * nunca pasa por HealthFlow — cambiarla ocurre en el portal de Stripe, que es
 * también lo que nos mantiene fuera del alcance de PCI.
 */
export interface MetodoPagoView {
  marca: string;
  ultimos4: string;
  expiraMes: number;
  expiraAnio: number;
}

/** Un cobro del historial. Importes en centavos, como el resto del dominio. */
export interface PagoView {
  id: string;
  /** Folio de Stripe (p. ej. "A1B2C3-0001"). Null en facturas sin numerar. */
  numero: string | null;
  /** Fecha de pago si se cobró; si no, la de emisión. ISO. */
  fecha: string;
  montoCentavos: number;
  moneda: string;
  /** Estado crudo de Stripe: 'paid' | 'open' | 'void' | 'uncollectible' | 'draft'. */
  estatus: string;
  /** Recibo en línea de Stripe. Null en borradores. */
  urlRecibo: string | null;
}

/**
 * Cobro pendiente que el titular puede liquidar AHORA, sin esperar a que
 * Stripe reintente por su cuenta (que puede tardar días).
 *
 * `urlPago` es la página de pago alojada por Stripe. Se manda ahí y no se
 * dispara el cobro desde el servidor por dos razones: el caso típico es que la
 * tarjeta guardada falló —así que reintentarla volvería a fallar— y porque la
 * autenticación 3DS/SCA la tiene que resolver el banco con el usuario delante.
 */
export interface PagoPendienteView {
  urlPago: string;
  montoCentavos: number;
  moneda: string;
  /** Fecha límite de la factura, si Stripe la define. */
  venceEl: string | null;
}

/**
 * GET /subscriptions/facturacion — plan, tarjeta e historial de cobros.
 *
 * Solo lo alcanza el TITULAR: el endpoint exige `read` sobre 'Cuenta', que en
 * la fábrica de CASL únicamente cubre el rol 'admin'. Un médico contratado no
 * tiene por qué ver lo que paga la clínica.
 */
export interface FacturacionView {
  plan: string;
  subscriptionStatus: string;
  /** 'mensual' | 'anual'. */
  billingPeriod: string;
  currentPeriodEnd: string | null;
  /** true si la clínica nunca pasó por Stripe (seeds, cuentas previas al self-serve). */
  sinCliente: boolean;
  metodoPago: MetodoPagoView | null;
  /** Factura abierta que se puede liquidar ya. null si no hay nada que deber. */
  pagoPendiente: PagoPendienteView | null;
  pagos: PagoView[];
  /**
   * false si Stripe no respondió. Distingue "esta clínica no tiene cobros"
   * de "no pudimos consultarlos", que en una pantalla de dinero no es lo
   * mismo: lo primero se afirma, lo segundo se advierte.
   */
  historialDisponible: boolean;
}

/**
 * GET /users/me: el perfil más el estado de pago de la clínica.
 *
 * Van juntos porque el AppShell necesita el estado de pago en TODAS las
 * pantallas y el perfil ya se leía; una respuesta ahorra un viaje. El PATCH del
 * perfil sigue devolviendo `UserProfile` a secas: editar la cédula no es un
 * momento en el que haga falta reevaluar la cobranza.
 */
export interface UserProfileMe extends UserProfile {
  suscripcion: SuscripcionEstadoView;
}

/** Perfil profesional propio: lo que aparece en la agenda y en la firma. */
export interface UpdatePerfilRequest {
  especialidadKey: EspecialidadKey;
  especialidad?: string;
  /** 'Dr.' | 'Dra.' | cadena vacía para quitar el título del membrete. */
  titulo?: TituloMedico | '';
  /** Cadena vacía = borrar la cédula guardada. */
  cedulaProfesional?: string;
  /** Cadena vacía = borrar la cédula guardada. */
  cedulaEspecialidad?: string;
  /** RIS art. 64. Cadena vacía = borrar el dato guardado, igual que las cédulas. */
  institucionTitulo?: string;
  /** '12h' o '24h'. Siempre se manda: no tiene semántica de "borrar". */
  formatoHora?: '12h' | '24h';
}

/** @deprecated Usa UpdatePerfilRequest — mismo cuerpo, más la cédula. */
export type UpdateEspecialidadRequest = UpdatePerfilRequest;

/**
 * PATCH /cuentas/clinica — dirección y teléfono para el membrete de
 * documentos impresos. Del titular ('admin') únicamente, mismo criterio que
 * el resto de `/cuentas`: es configuración de la clínica, no del médico que
 * mira. Cadena vacía = borrar el dato guardado, igual que las cédulas.
 */
/** Tamaños del logo en el membrete. Cerrado: el médico elige, no teclea píxeles. */
export const TAMANOS_LOGO = ['chico', 'mediano', 'grande'] as const;
export type TamanoLogo = (typeof TAMANOS_LOGO)[number];

/**
 * Apariencia de la receta impresa.
 *
 * Toca CÓMO SE VE, nunca QUÉ DATOS lleva. El artículo 64 del RIS obliga a
 * imprimir nombre, cédula, institución del título y domicilio del
 * establecimiento: nada de eso es ocultable desde aquí, porque una receta
 * legalmente incompleta saldría con nuestro software y con la firma del
 * médico. Lo que sí se puede ocultar es lo que la ley no pide (la
 * especialidad, la leyenda del pie).
 */
/**
 * Bloques reordenables del cuerpo de la receta.
 *
 * Solo el CUERPO: el membrete, la ficha del paciente y la firma tienen
 * posición fija porque su lugar es parte de cómo se lee un documento médico.
 * Lo que cada consultorio sí acomoda distinto es el orden en que expone el
 * padecimiento y el tratamiento.
 */
export const SECCIONES_RECETA = ['diagnostico', 'indicaciones', 'prescripcion'] as const;
export type SeccionReceta = (typeof SECCIONES_RECETA)[number];

/** Encabezados por omisión de cada bloque. Cada clínica los renombra a su gusto. */
export const ETIQUETAS_RECETA_DEFAULT: Record<SeccionReceta | 'firma', string> = {
  diagnostico: 'Diagnóstico',
  indicaciones: 'Indicaciones generales',
  prescripcion: 'Prescripción',
  firma: 'Firma autógrafa del médico',
};

/**
 * Deja el orden en un estado siempre imprimible: quita repetidos y desconocidos
 * y agrega al final los que falten.
 *
 * Existe porque este arreglo viaja en un jsonb que ya está guardado: una
 * versión vieja, un cliente que mande de más o una sección nueva del catálogo
 * no pueden hacer que una receta se imprima con un bloque duplicado o sin el
 * diagnóstico.
 */
export function normalizarOrdenSecciones(orden: readonly string[] | undefined): SeccionReceta[] {
  const vistas = new Set<SeccionReceta>();
  for (const clave of orden ?? []) {
    if ((SECCIONES_RECETA as readonly string[]).includes(clave)) vistas.add(clave as SeccionReceta);
  }
  for (const clave of SECCIONES_RECETA) vistas.add(clave);
  return [...vistas];
}

export interface ConfigReceta {
  logoTamano: TamanoLogo;
  /** Orden de los bloques del cuerpo, de arriba abajo. */
  ordenSecciones: SeccionReceta[];
  /** Encabezado de cada bloque y del pie de firma. Vacío = el de por omisión. */
  etiquetas: Record<SeccionReceta | 'firma', string>;
  /**
   * Dónde se imprime el domicilio y el teléfono del consultorio. El art. 64
   * del RIS exige el domicilio, no dice dónde: hay quien lo quiere arriba con
   * el membrete y quien lo pone al pie junto al horario.
   */
  posicionDomicilio: 'encabezado' | 'pie';
  /** La especialidad no la exige el art. 64: es del gusto de cada quien. */
  mostrarEspecialidad: boolean;
  mostrarLeyendaPie: boolean;
  /**
   * Color de los acentos (línea del membrete y títulos de sección). null =
   * el gris por omisión. Solo acentos, nunca el texto del contenido: una
   * receta se imprime a menudo en blanco y negro y en fax de farmacia, y el
   * contenido tiene que leerse igual.
   */
  colorAcento: string | null;
  /**
   * El consultorio ya imprime en hojas con su membrete. Reserva el espacio
   * superior y omite logo, nombre y domicilio de la clínica, que el papel ya
   * trae. Los datos del MÉDICO se siguen imprimiendo siempre.
   */
  papelMembretado: boolean;
}

/**
 * Valores por omisión: reproducen EXACTAMENTE la receta tal como se imprimía
 * antes de que esto fuera configurable. Es lo que se usa al leer una receta
 * emitida sin configuración guardada, de modo que ningún documento histórico
 * cambie de aspecto por una función nueva.
 */
export const CONFIG_RECETA_DEFAULT: ConfigReceta = {
  logoTamano: 'mediano',
  ordenSecciones: [...SECCIONES_RECETA],
  etiquetas: { ...ETIQUETAS_RECETA_DEFAULT },
  posicionDomicilio: 'encabezado',
  mostrarEspecialidad: true,
  mostrarLeyendaPie: true,
  colorAcento: null,
  papelMembretado: false,
};

export interface ActualizarDatosClinicaRequest {
  /** Nombre comercial del consultorio, tal como sale en el membrete. */
  nombreClinica?: string;
  direccion?: string;
  telefono?: string;
  /** Se manda completa o no se manda: no hay actualización parcial de la apariencia. */
  configReceta?: ConfigReceta;
  /** Texto libre para el pie de la receta impresa. Cadena vacía = borrar. */
  leyendaPie?: string;
}

/**
 * Títulos con los que un médico puede firmar el membrete impreso. Lista
 * cerrada y no texto libre: es lo que se imprime junto al nombre en un
 * documento legal, y un catálogo evita "dr", "DR." y "Doctora" conviviendo en
 * las recetas de la misma clínica.
 */
export const TITULOS_MEDICO = ['Dr.', 'Dra.'] as const;
export type TituloMedico = (typeof TITULOS_MEDICO)[number];

/**
 * Compone el nombre del membrete impreso.
 *
 * No concatena a ciegas: durante mucho tiempo el único lugar para el trato fue
 * el propio campo de nombre, así que hay cuentas capturadas como "Dra. Mariana
 * Cervantes". Anteponerle el título otra vez imprimiría "Dra. Dra. Mariana
 * Cervantes" en una receta —un documento que sale del consultorio en manos del
 * paciente—, y el médico no tendría forma de entender por qué.
 */
export function nombreConTitulo(
  titulo: TituloMedico | null | undefined,
  nombre: string,
): string {
  if (!titulo) return nombre;
  const yaLoTrae = /^\s*(dr|dra)\.?\s/i.test(nombre);
  return yaLoTrae ? nombre : `${titulo} ${nombre}`;
}

/** Tipos MIME aceptados para el logo de la clínica (mismo criterio que radiografías). */
export const MIME_TYPES_LOGO_CLINICA = ['image/jpeg', 'image/png'] as const;
export type MimeTypeLogoClinica = (typeof MIME_TYPES_LOGO_CLINICA)[number];

export interface RequestLogoUploadUrlRequest {
  mimeType: MimeTypeLogoClinica;
}

/** Misma forma que RequestUploadUrlResponse (radiografías): subida directa a storage. */
export interface RequestLogoUploadUrlResponse {
  uploadUrl: string;
  headers: Record<string, string>;
  storageKey: string;
}

export interface ConfirmLogoRequest {
  storageKey: string;
  mimeType: MimeTypeLogoClinica;
}

export interface LogoClinicaView {
  /** URL firmada de corta duración, lista para <img src>. */
  url: string;
}

/** GET /cuentas/clinica — lo que pinta Ajustes → Receta. */
export interface DatosClinicaView {
  nombreClinica: string;
  configReceta: ConfigReceta;
  direccion: string | null;
  telefono: string | null;
  leyendaPie: string | null;
  /** URL firmada, resuelta en esta petición. null = la clínica no tiene logo. */
  logoUrl: string | null;
}

// ── Suscripciones (Stripe) / onboarding self-serve ────────────────
export const SELF_SERVE_PLANS = ['individual', 'consultorio'] as const;
export type SelfServePlan = (typeof SELF_SERVE_PLANS)[number];

/** Periodicidad de cobro. El plan anual lleva 20% de descuento. */
export const BILLING_PERIODS = ['mensual', 'anual'] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

export interface CreateCheckoutSessionRequest {
  nombreClinica: string;
  ownerNombre: string;
  email: string;
  password: string;
  plan: SelfServePlan;
  periodo: BillingPeriod;
  /** Personaliza la nota clínica desde el primer día. Ausente ⇒ 'general'. */
  especialidad?: EspecialidadKey;
}

export interface CreateCheckoutSessionResponse {
  /** URL de Stripe Checkout hospedado — redirigir el browser aquí. */
  url: string;
}

export interface ExchangeTicketRequest {
  stripeSessionId: string;
}

/** 202 mientras el webhook de Stripe aún no provisiona la cuenta. */
export interface ExchangeTicketPendingResponse {
  status: 'pending';
}

/** 410 si el ticket ya se usó o expiró. */
export interface ExchangeTicketExpiredResponse {
  status: 'expired';
}

// ── Asistente de transcripción con IA ─────────────────────────────
//
// El médico graba la consulta y el modelo devuelve un BORRADOR de la nota.
// Todo lo que sale de aquí es una sugerencia que el médico revisa y corrige
// antes de firmar: la responsabilidad del expediente no se delega.

/** Contenedores que el navegador puede producir con MediaRecorder. */
export const MIME_TYPES_AUDIO = ['audio/webm', 'audio/ogg', 'audio/mp4'] as const;
export type MimeTypeAudio = (typeof MIME_TYPES_AUDIO)[number];

/**
 * Lo que el asistente propone tras escuchar la consulta.
 *
 * Tipo PLANO y con todo opcional, en vez de un `Partial<NotaEvolucionContent>`:
 * una sugerencia no es una nota a medio hacer. Solo viajan las claves que el
 * modelo pudo inferir de lo que se dijo; lo que no se mencionó viene ausente,
 * nunca relleno con texto genérico — un campo inventado en un expediente es
 * peor que un campo vacío. Y `signosVitales` es parcial de verdad: si en la
 * consulta solo se dijo la presión, viaja la presión y nada más, sin fingir
 * que se midió el resto.
 *
 * El frontend MEZCLA esto sobre lo que el médico ya escribió; jamás reemplaza.
 */
export interface SugerenciaNotaIa {
  padecimientoActual?: string;
  hallazgos?: string;
  planTerapeutico?: string;
  signosVitales?: Partial<SignosVitales>;
  /** Candidatos a revisar, NUNCA diagnósticos en firme. */
  diagnosticos?: DiagnosticoCie10[];
  /** Campos propios de la especialidad, llaveados por `CampoExtra.key`. */
  extension?: Record<string, string | number | null>;
  /**
   * Hallazgos dentales que el médico dictó, en notación FDI. Solo se piden en
   * odontología.
   *
   * Van como lista de marcas y NO como un `Odontograma` completo a propósito:
   * la dentición (permanente/temporal/mixta) la eligió el dentista y no la
   * decide una transcripción. Se agregan a lo que ya haya marcado, nunca lo
   * reemplazan — un diente marcado a mano vale más que uno escuchado.
   */
  odontograma?: MarcaDental[];
}

export interface TranscribirConsultaResponse {
  contenido: SugerenciaNotaIa;
  /** Avisos para el médico, p.ej. "no se detectaron signos vitales en el audio". */
  advertencias: string[];
}

/**
 * Claves que el asistente puede proponer. Se usa para marcar en la interfaz
 * qué escribió la IA y qué escribió el médico.
 */
export const CAMPOS_SUGERIBLES_IA = [
  'padecimientoActual',
  'hallazgos',
  'planTerapeutico',
  'signosVitales',
  'diagnosticos',
  'extension',
  'odontograma',
] as const satisfies readonly (keyof SugerenciaNotaIa)[];
export type CampoSugeribleIa = (typeof CAMPOS_SUGERIBLES_IA)[number];

// ── Cupos del plan contratado ─────────────────────────────────────
//
// Lo que la página de precios promete, expresado como datos y en UN solo
// lugar: la API cobra estos límites al dar de alta cuentas o pacientes, y la
// UI los muestra con el mismo objeto. Si el precio cambia, se cambia aquí.
//
// `null` = sin límite.

export interface LimitesPlan {
  /** Nombre comercial, tal cual aparece en la página de precios. */
  nombre: string;
  /**
   * Asientos de médico. Cuentan tanto los usuarios con rol 'medico' como el
   * dueño de la cuenta ('admin' con es_medico), porque el dueño también
   * atiende y ocupa lugar en la agenda.
   */
  maxMedicos: number | null;
  /**
   * Asistentes. NO consumen asiento de médico: son personal de recepción, y
   * el plan se vende por médicos. Van aparte a propósito.
   */
  maxAsistentes: number | null;
  maxPacientes: number | null;
}

export const LIMITES_PLAN: Record<string, LimitesPlan> = {
  individual: { nombre: 'Individual', maxMedicos: 1, maxAsistentes: 1, maxPacientes: 300 },
  consultorio: { nombre: 'Consultorio', maxMedicos: 5, maxAsistentes: 1, maxPacientes: null },
  /** Plan a cotización: los cupos se pactan en el contrato, no en el código. */
  clinica: { nombre: 'Clínica', maxMedicos: null, maxAsistentes: null, maxPacientes: null },
};

/**
 * Límites del plan de un tenant, con caída SEGURA al plan más chico.
 *
 * Nunca lanza y nunca regala capacidad: un `plan` desconocido (una cuenta
 * anterior a los planes self-serve, un valor tecleado a mano) se trata como
 * Individual. Ante la duda, el cupo más conservador — es la diferencia entre
 * cobrar de menos y regalar el producto.
 */
export function limitesDePlan(plan: string | null | undefined): LimitesPlan {
  if (!plan) return LIMITES_PLAN.individual!;
  // Alias heredados de antes de que existieran los planes self-serve.
  const normalizado = plan === 'pro' ? 'consultorio' : plan === 'free' ? 'individual' : plan;
  return LIMITES_PLAN[normalizado] ?? LIMITES_PLAN.individual!;
}

// ── Cuentas del consultorio ───────────────────────────────────────
//
// El titular de la cuenta (rol 'admin') da de alta al resto del equipo: otros
// médicos —cada uno con su propio expediente y agenda, pero bajo la misma
// clínica— y la cuenta de asistente que le ayuda con la agenda.

/** Roles que el titular puede dar de alta. 'admin' no está: hay uno solo. */
export const ROLES_ASIGNABLES = ['medico', 'asistente'] as const;
export type RolAsignable = (typeof ROLES_ASIGNABLES)[number];

export interface CuentaView {
  id: string;
  nombre: string;
  email: string;
  rol: UserRole;
  /** Atiende consulta (aparece en la agenda). True para el titular. */
  esMedico: boolean;
  especialidad: string | null;
  especialidadKey: EspecialidadKey;
  cedulaProfesional: string | null;
  /** Una cuenta desactivada no puede iniciar sesión y libera su cupo. */
  activo: boolean;
  /** Médico al que asiste (solo asistentes). */
  medicoTitularId: string | null;
  medicoTitularNombre: string | null;
  /** True para el dueño de la suscripción: no se puede desactivar a sí mismo. */
  esTitular: boolean;
  createdAt: string;
}

/** Cuentas del consultorio + cupos del plan, en una sola respuesta. */
export interface CuentasResumen {
  plan: string;
  limites: LimitesPlan;
  /** Cuentas ACTIVAS de cada tipo (las desactivadas no ocupan cupo). */
  medicosActivos: number;
  asistentesActivos: number;
  cuentas: CuentaView[];
}

export interface CrearCuentaRequest {
  nombre: string;
  email: string;
  password: string;
  rol: RolAsignable;
  /** Solo médicos. */
  cedulaProfesional?: string;
  especialidad?: string;
  especialidadKey?: EspecialidadKey;
  /** Solo asistentes: a qué médico asiste. Ausente ⇒ al titular de la cuenta. */
  medicoTitularId?: string;
}

/** Alta/baja de una cuenta ya existente. */
export interface ActualizarCuentaRequest {
  activo: boolean;
}

/** Cupos libres de un plan, ya calculados. */
export interface CuposPlan {
  medicosDisponibles: number | null;
  asistentesDisponibles: number | null;
  puedeAgregarMedico: boolean;
  puedeAgregarAsistente: boolean;
}

/**
 * Cuánto cupo queda. Función pura y compartida: la API la usa para RECHAZAR y
 * la web para deshabilitar el botón. Una sola aritmética evita el peor caso de
 * UX —dejar llenar el formulario y fallar al enviar— y el peor de negocio
 * —que la UI permita lo que el plan no incluye.
 */
export function cuposDisponibles(
  limites: LimitesPlan,
  medicosActivos: number,
  asistentesActivos: number,
): CuposPlan {
  const medicosDisponibles =
    limites.maxMedicos === null ? null : Math.max(0, limites.maxMedicos - medicosActivos);
  const asistentesDisponibles =
    limites.maxAsistentes === null ? null : Math.max(0, limites.maxAsistentes - asistentesActivos);

  return {
    medicosDisponibles,
    asistentesDisponibles,
    puedeAgregarMedico: medicosDisponibles === null || medicosDisponibles > 0,
    puedeAgregarAsistente: asistentesDisponibles === null || asistentesDisponibles > 0,
  };
}

// ── Presupuestos y cobranza ──────────────────────────────────────
//
// El plan de tratamiento cotizado. Vive en el PACIENTE y no en la cita: un
// tratamiento dental abarca varias sesiones a lo largo de meses, mientras que
// una factura pertenece a UNA cita (ver 0006_billing.sql).
//
// Todos los montos van en CENTAVOS enteros, igual que el dominio de
// facturación (ver ConceptoCfdi): mezclar decimales entre módulos que se
// alimentan entre sí es la receta para descuadres de un peso.

export const ESTATUS_PRESUPUESTO = [
  'borrador',
  'presentado',
  'aceptado',
  'rechazado',
  'terminado',
  'cancelado',
] as const;
export type EstatusPresupuesto = (typeof ESTATUS_PRESUPUESTO)[number];

export const ESTATUS_PARTIDA = ['pendiente', 'en_proceso', 'terminado', 'cancelada'] as const;
export type EstatusPartida = (typeof ESTATUS_PARTIDA)[number];

export const METODOS_PAGO = ['efectivo', 'tarjeta', 'transferencia', 'otro'] as const;
export type MetodoPago = (typeof METODOS_PAGO)[number];

export interface PresupuestoPartida {
  id: string;
  descripcion: string;
  /** Piezas FDI a las que aplica ('16', '26'). Vacío = no aplica a una pieza. */
  piezas: string[];
  /** Agrupa el trabajo en etapas del tratamiento. */
  fase: number;
  cantidad: number;
  valorUnitarioCentavos: number;
  estatus: EstatusPartida;
  /** Cita donde se ejecutó; null mientras no se realiza. */
  appointmentId: string | null;
  /** Importe = cantidad × valor unitario, derivado por el backend. */
  importeCentavos: number;
}

export interface Abono {
  id: string;
  montoCentavos: number;
  metodo: MetodoPago;
  /** ISO date (YYYY-MM-DD). */
  fecha: string;
  referencia: string | null;
}

/**
 * Presupuesto con sus totales YA calculados por el backend.
 *
 * `totalCentavos`, `abonadoCentavos` y `saldoCentavos` NO se guardan en la
 * base: se derivan de partidas y abonos en cada consulta. Un saldo almacenado
 * habría que mantenerlo sincronizado en cada alta, baja y edición, y un saldo
 * desfasado en cobranza es una discusión con el paciente frente al mostrador.
 */
export interface PresupuestoView {
  id: string;
  patientId: string;
  patientNombre: string;
  doctorId: string;
  titulo: string;
  estatus: EstatusPresupuesto;
  notas: string | null;
  vigenciaHasta: string | null;
  aceptadoEn: string | null;
  createdAt: string;
  partidas: PresupuestoPartida[];
  abonos: Abono[];
  /** Suma de las partidas NO canceladas. */
  totalCentavos: number;
  abonadoCentavos: number;
  /** total − abonado. Puede ser 0, nunca negativo (se valida al abonar). */
  saldoCentavos: number;
}

export interface CrearPresupuestoRequest {
  patientId: string;
  titulo: string;
  notas?: string;
  vigenciaHasta?: string;
  partidas: NuevaPartida[];
}

export interface NuevaPartida {
  descripcion: string;
  piezas?: string[];
  fase?: number;
  cantidad: number;
  valorUnitarioCentavos: number;
}

export interface RegistrarAbonoRequest {
  montoCentavos: number;
  metodo: MetodoPago;
  fecha?: string;
  referencia?: string;
}

// ── Caja (corte de caja) ─────────────────────────────────────────
//
// Tesorería del consultorio: cuánto dinero hay HOY en el cajón de recepción.
// Distinto de `presupuestos` (cobranza: cuánto debe el paciente) y de
// `facturas` (el acto fiscal ante el SAT). Un cobro de caja puede alimentar a
// los tres, pero cada uno responde una pregunta diferente.
//
// Montos en CENTAVOS enteros, como todo el dinero de la app.

export const TIPOS_MOVIMIENTO_CAJA = ['ingreso', 'egreso', 'retiro'] as const;
/**
 * `ingreso` entra dinero (cobro), `egreso` es un gasto pagado desde el cajón,
 * `retiro` es efectivo que se lleva a bóveda/banco — sale del cajón pero no es
 * un gasto, y por eso se cuenta aparte en el corte.
 */
export type TipoMovimientoCaja = (typeof TIPOS_MOVIMIENTO_CAJA)[number];

export interface MovimientoCaja {
  id: string;
  tipo: TipoMovimientoCaja;
  concepto: string;
  montoCentavos: number;
  metodo: MetodoPago;
  /** Contexto opcional: un cobro de mostrador puede no tener paciente. */
  patientId: string | null;
  appointmentId: string | null;
  presupuestoId: string | null;
  /** Abono generado en el presupuesto por este cobro, si se ligó a uno. */
  abonoId: string | null;
  referencia: string | null;
  registradoPor: string;
  createdAt: string;
  /** Cancelación lógica: el movimiento sigue en el corte, sin sumar. */
  canceladoEn: string | null;
  canceladoPor: string | null;
  motivoCancelacion: string | null;
}

export interface MovimientoCajaView extends MovimientoCaja {
  patientNombre: string | null;
  registradoPorNombre: string;
  canceladoPorNombre: string | null;
}

/**
 * Corte de caja. Todo se deriva de los movimientos NO cancelados: nada de
 * esto se guarda en la base, porque un total almacenado que se desfasa —en un
 * corte de caja— es una acusación de robo contra alguien.
 */
export interface ResumenCaja {
  fondoInicialCentavos: number;
  /** Suma de todos los ingresos, sin importar el método de pago. */
  ingresosCentavos: number;
  egresosCentavos: number;
  retirosCentavos: number;
  /** Ingresos desglosados por método; lo que se concilia contra la terminal. */
  ingresosPorMetodo: Record<MetodoPago, number>;
  /** fondo + ingresos en efectivo − egresos en efectivo − retiros. Lo que debería haber en el cajón. */
  efectivoEsperadoCentavos: number;
  /** Lo que el usuario contó al cerrar. `null` mientras el turno sigue abierto. */
  efectivoContadoCentavos: number | null;
  /** contado − esperado. Negativo = falta dinero. `null` si sigue abierto. */
  diferenciaCentavos: number | null;
}

export interface TurnoCajaResumen {
  id: string;
  abierta: boolean;
  abiertaPor: string;
  abiertaPorNombre: string;
  abiertaEn: string;
  notasApertura: string | null;
  cerradaPor: string | null;
  cerradaPorNombre: string | null;
  cerradaEn: string | null;
  notasCierre: string | null;
  resumen: ResumenCaja;
}

/** El turno con su detalle. Los cancelados vienen incluidos y marcados. */
export interface TurnoCajaView extends TurnoCajaResumen {
  movimientos: MovimientoCajaView[];
}

export interface AbrirCajaRequest {
  fondoInicialCentavos: number;
  notas?: string;
}

export interface RegistrarMovimientoCajaRequest {
  tipo: TipoMovimientoCaja;
  concepto: string;
  montoCentavos: number;
  metodo: MetodoPago;
  patientId?: string;
  appointmentId?: string;
  /** Si se manda en un `ingreso`, además se registra el abono al presupuesto. */
  presupuestoId?: string;
  referencia?: string;
}

/** Corrección de captura. No incluye el tipo: un ingreso no se vuelve egreso. */
export interface ActualizarMovimientoCajaRequest {
  concepto?: string;
  montoCentavos?: number;
  metodo?: MetodoPago;
  referencia?: string;
}

export interface CancelarMovimientoCajaRequest {
  motivo: string;
}

export interface CerrarCajaRequest {
  efectivoContadoCentavos: number;
  notas?: string;
}

/**
 * Consentimiento informado. Insert-only: no hay estatus ni transición — se
 * crea ya completo, y ni la API ni los permisos de base de datos exponen
 * forma alguna de editarlo o borrarlo (ver 0015_consentimientos.sql).
 */
export interface ConsentimientoView {
  id: string;
  patientId: string;
  presupuestoId: string | null;
  doctorId: string;
  doctorNombre: string;
  procedimiento: string;
  contenido: string;
  createdAt: string;
}

export interface CrearConsentimientoRequest {
  patientId: string;
  presupuestoId?: string;
  procedimiento: string;
  contenido: string;
}

/** Tipos de imagen aceptados. Sin SVG a propósito: es un vector de XSS. */
export const MIME_TYPES_RADIOGRAFIA = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type MimeTypeRadiografia = (typeof MIME_TYPES_RADIOGRAFIA)[number];

/**
 * Radiografía (imagen clínica). El archivo vive en storage S3-compatible, no
 * en Postgres — `url` es una URL prefirmada de vida corta que se regenera en
 * cada listado, nunca un enlace público permanente.
 */
export interface RadiografiaView {
  id: string;
  patientId: string;
  url: string;
  mimeType: string;
  subidoPorNombre: string;
  createdAt: string;
}

export interface RequestUploadUrlRequest {
  patientId: string;
  mimeType: MimeTypeRadiografia;
}

/**
 * Instrucciones de subida directa al storage: un PUT con el archivo como body
 * y estas cabeceras exactas (van firmadas). No es un formulario multipart —
 * el presigned POST de S3 no existe en R2.
 */
export interface RequestUploadUrlResponse {
  uploadUrl: string;
  headers: Record<string, string>;
  storageKey: string;
}

export interface ConfirmRadiografiaRequest {
  patientId: string;
  storageKey: string;
  mimeType: MimeTypeRadiografia;
}

/** Resumen de cobranza para el tablero de finanzas. */
export interface SaldosPorCobrar {
  /** Suma de saldos de presupuestos aceptados aún no terminados. */
  totalCentavos: number;
  presupuestos: {
    id: string;
    patientId: string;
    patientNombre: string;
    titulo: string;
    saldoCentavos: number;
  }[];
}

// ── Expediente clínico / NOM-004 ─────────────────────────────────

export const CLINICAL_NOTE_TYPES = ['nota_evolucion', 'historia_clinica'] as const;
export type ClinicalNoteType = (typeof CLINICAL_NOTE_TYPES)[number];

export const CLINICAL_NOTE_STATUSES = ['borrador', 'cerrada'] as const;
export type ClinicalNoteStatus = (typeof CLINICAL_NOTE_STATUSES)[number];

/** Signos vitales. `ta` (tensión arterial) es obligatorio para cerrar (NOM-004). */
export interface SignosVitales {
  ta: string | null; // p.ej. "120/80"
  fc: string | null; // frecuencia cardiaca
  fr: string | null; // frecuencia respiratoria
  temp: string | null; // °C
  spo2: string | null; // %
  peso: string | null; // kg
  talla: string | null; // m
}

export interface DiagnosticoCie10 {
  cie10: string;
  descripcion: string;
}

export interface FirmaMedica {
  medicoNombre: string;
  cedula: string | null;
  fecha: string; // ISO datetime del cierre
}

/**
 * Contenido estructurado de una nota de evolución (consulta subsecuente).
 * Se guarda como JSONB en `clinical_notes.contenido_nom004`. Mezcla texto
 * enriquecido (HTML de TipTap) con datos estructurados aprovechables para
 * estadísticas (diagnósticos, signos vitales).
 */
export interface NotaEvolucionContent {
  tipoNota: ClinicalNoteType;
  padecimientoActual: string; // HTML (TipTap)
  exploracionFisica: {
    signosVitales: SignosVitales;
    hallazgos?: string;
  };
  diagnosticos: DiagnosticoCie10[];
  planTerapeutico: string;
  firma?: FirmaMedica; // se llena al cerrar
  /**
   * Especialidad con la que se abrió la nota. Se ESTAMPA al crear el borrador
   * y ya no cambia: si el médico cambia de especialidad el año que entra, sus
   * notas viejas deben seguir mostrando los campos con los que se firmaron.
   * Ausente = notas anteriores a esta función ⇒ se tratan como 'general'.
   */
  especialidad?: EspecialidadKey;
  /**
   * Campos propios de la especialidad, llaveados por `CampoExtra.key`.
   *
   * Mapa plano y NO una unión discriminada, a propósito: la nota se guarda como
   * jsonb y por NOM-004 una nota cerrada es inmutable y debe poder leerse para
   * siempre. Así, cambiar el catálogo de especialidades nunca obliga a migrar
   * expedientes históricos.
   */
  extension?: Record<string, string | number | null>;
  /**
   * El médico declaró que en esta consulta NO se tomaron signos vitales. Solo
   * lo permiten las especialidades cuyo perfil trae `permiteOmitirSignosVitales`
   * (ver PERFILES). Se guarda dentro de la nota, así que el expediente muestra
   * una decisión documentada y no un campo en blanco.
   */
  signosVitalesOmitidos?: boolean;
  /** Motivo opcional de la omisión. Refuerza el respaldo médico-legal. */
  motivoOmisionSignosVitales?: string;
  /**
   * Estado dental registrado en ESTA consulta. Vive en la nota y no en el
   * paciente para que quede congelado con la firma: así el expediente muestra
   * cómo estaba la boca en cada visita, no solo cómo está hoy.
   *
   * Al abrir una consulta nueva se precarga con el de la última nota cerrada,
   * de modo que el dentista solo marca lo que cambió.
   */
  odontograma?: Odontograma;
  /**
   * Mapa podológico de ESTA consulta. Mismo criterio que el odontograma: vive
   * en la nota y no en el paciente para que quede congelado con la firma, de
   * modo que el expediente muestre cómo estaba el pie en cada visita.
   *
   * Se precarga con el de la última nota cerrada al abrir una consulta nueva:
   * las lesiones del pie evolucionan lento, y volver a marcar de cero una
   * úlcera que lleva meses es trabajo tirado. El podólogo solo ajusta lo que
   * cambió.
   */
  podograma?: Podograma;
  /**
   * Localización visual de heridas y estomas en vistas anterior/posterior.
   * Vive en la nota por la misma razón que odontograma y podograma: al firmar
   * queda congelado el estado anatómico documentado en esa consulta.
   */
  mapaCorporal?: MapaCorporal;
  /**
   * Antecedentes de la HISTORIA CLÍNICA inicial (NOM-004), presentes solo
   * cuando `tipoNota === 'historia_clinica'`. Viven como campos planos en la
   * misma interfaz, no en un tipo aparte: igual que `extension` arriba, una
   * nota cerrada debe poder leerse para siempre sin depender de una unión
   * discriminada que un cambio de código pueda romper.
   */
  antecedentesHeredofamiliares?: string;
  antecedentesPersonalesPatologicos?: string;
  antecedentesPersonalesNoPatologicos?: string;
}

/** Contenido vacío inicial de un borrador de nota de evolución. */
export const EMPTY_NOTA_EVOLUCION: NotaEvolucionContent = {
  tipoNota: 'nota_evolucion',
  padecimientoActual: '',
  exploracionFisica: {
    signosVitales: { ta: null, fc: null, fr: null, temp: null, spo2: null, peso: null, talla: null },
    hallazgos: '',
  },
  diagnosticos: [],
  planTerapeutico: '',
};

/** Contenido vacío inicial de la historia clínica de la primera visita. */
export const EMPTY_HISTORIA_CLINICA: NotaEvolucionContent = {
  ...EMPTY_NOTA_EVOLUCION,
  tipoNota: 'historia_clinica',
  antecedentesHeredofamiliares: '',
  antecedentesPersonalesPatologicos: '',
  antecedentesPersonalesNoPatologicos: '',
};

/**
 * Anotación aclaratoria sobre una nota YA CERRADA.
 *
 * La NOM-004 no admite enmendaduras: una nota firmada no se reescribe. La
 * corrección se agrega al lado, firmada y fechada por quien la hace, y la
 * original se conserva intacta — que es justo lo que un perito espera ver.
 */
export interface CorreccionNota {
  id: string;
  texto: string;
  /** Congelados al firmar: si el médico corrige su cédula después, esta adenda no cambia. */
  autorNombre: string;
  autorCedula: string | null;
  createdAt: string;
}

/** Mínimo de caracteres de una corrección: obliga a explicar, no solo a teclear. */
export const CORRECCION_TEXTO_MIN = 10;
export const CORRECCION_TEXTO_MAX = 2000;

export interface CrearCorreccionRequest {
  texto: string;
}

export interface ClinicalNoteView {
  id: string;
  appointmentId: string;
  doctorId: string;
  tipoNota: ClinicalNoteType;
  estatus: ClinicalNoteStatus;
  contenido: NotaEvolucionContent;
  cerradoEn: string | null;
  createdAt: string;
  /**
   * Correcciones posteriores al cierre, en orden cronológico. Viajan CON la
   * nota y no en una petición aparte: leer una nota corregida sin ver su
   * corrección sería leer información que el médico ya rectificó.
   */
  correcciones: CorreccionNota[];
}

/** Tamaño de página por omisión y tope duro del historial del expediente. */
export const NOTAS_PAGE_SIZE = 20;
export const NOTAS_PAGE_SIZE_MAX = 50;

export interface ClinicalRecordView {
  recordId: string;
  patientId: string;
  patientNombre: string;
  /** Viaja con el expediente para poder corregirlo sin una petición aparte. */
  patientTelefono: string | null;
  /** YYYY-MM-DD. Viaja con el expediente por el mismo motivo que el teléfono. */
  patientFechaNacimiento: string;
  abiertoEn: string;
  /** Una PÁGINA de notas, de la más reciente a la más antigua. */
  notas: ClinicalNoteView[];
  /**
   * Cursor opaco para pedir la página siguiente; null cuando ya no hay más.
   * No lo interpretes en el cliente: su formato es un detalle del servidor.
   */
  nextCursor: string | null;
  /**
   * Total de notas del expediente, independiente de la paginación.
   *
   * Existe porque la cabecera dice "N notas": mostrar ahí el largo de la
   * página haría que un expediente de 137 notas se anunciara como de 20, y en
   * un expediente clínico un conteo equivocado no es un detalle cosmético.
   */
  totalNotas: number;
  /**
   * Viaja con el expediente para que el editor de consulta pueda advertir de
   * las alergias SIN una segunda petición: la alerta tiene que estar en
   * pantalla antes de que el médico empiece a escribir, no después.
   */
  historial: HistorialPaciente;
}

/** Cuerpo de PATCH /patients/:id/historial. */
export interface UpdateHistorialRequest {
  sinAlergiasConocidas: boolean;
  alergias: Alergia[];
  antecedentes: AntecedentesPaciente;
  /**
   * Opcional a diferencia del resto: omitirlo deja el valor guardado como
   * está. Es lo que permite que el modal de receta capture SOLO el sexo, sin
   * tener que reenviar alergias y antecedentes que no está editando.
   */
  sexo?: SexoPaciente | null;
}

// ── DTOs de consulta ─────────────────────────────────────────────

export interface StartConsultationResponse {
  appointmentId: string;
  noteId: string;
  patientId: string;
}

export interface SaveNoteDraftRequest {
  contenido: NotaEvolucionContent;
}

export interface FinishConsultationRequest {
  contenido: NotaEvolucionContent;
}

export interface FinishConsultationResponse {
  appointmentId: string;
  noteId: string;
  estatus: ClinicalNoteStatus;
  cerradoEn: string;
}

// ── Dashboard ────────────────────────────────────────────────────

export interface CitasPorDia {
  fecha: string; // ISO date (YYYY-MM-DD)
  label: string; // inicial del día: L, M, M, J, V, S, D
  total: number;
}

export interface DashboardStats {
  citasHoy: number;
  completadasHoy: number;
  enEsperaHoy: number;
  tiempoPromedioMin: number | null; // duración promedio real de consulta (últimos 30 días)
  citasDelMes: number;
  tasaNoShows: number; // porcentaje 0-100 del mes en curso
  citasPorDia: CitasPorDia[]; // últimos 7 días
}

// ── Calendario ───────────────────────────────────────────────────

/** Cita enriquecida con nombres, para pintar el calendario. */
export interface AppointmentView {
  id: string;
  patientId: string;
  patientNombre: string;
  doctorId: string;
  doctorNombre: string;
  motivo: string | null;
  inicioProgramado: string; // ISO datetime
  finProgramado: string; // ISO datetime
  estatus: AppointmentStatus;
  origen: 'interno' | 'publico';
  estadoConfirmacion: ConfirmationStatus;
  posibleDuplicado: boolean;
}

export interface CreateAppointmentRequest {
  patientId: string;
  doctorId: string;
  motivo?: string | null;
  inicioProgramado: string; // ISO datetime
  finProgramado: string; // ISO datetime
}

export interface CancelAppointmentRequest {
  motivo?: string | null;
}

export interface DoctorSummary {
  id: string;
  nombre: string;
  especialidad: string | null;
}

// ── Reserva pública y mensajería ────────────────────────────────
export type BookingChannel = 'whatsapp' | 'email' | 'ninguno';
export type ConfirmationStatus = 'pendiente' | 'confirmada' | 'cancelada';

export interface BookingSettings {
  slug: string;
  publicado: boolean;
  directorioPublico: boolean;
  featureActiva: boolean;
  timezone: string;
  anticipacionMinimaHoras: number;
  horizonteDias: number;
  limiteCancelacionHoras: number;
  recordatoriosHoras: number[];
  avisoPrivacidadVersion: string;
}

export interface BookingService {
  id: string;
  nombre: string;
  duracionMinutos: number;
  precioCentavos: number | null;
  publico: boolean;
  activo: boolean;
  orden: number;
  doctorIds: string[];
}

export interface PublicBookingPage {
  clinicName: string;
  timezone: string;
  minNoticeHours: number;
  horizonDays: number;
  privacyNoticeVersion: string;
  services: BookingService[];
  doctors: DoctorSummary[];
}

/** Profesional publicado en el directorio de reservas de HealthFlow. */
export interface PublicDirectoryResult {
  clinicName: string;
  clinicAddress: string | null;
  slug: string;
  doctorId: string;
  doctorName: string;
  specialty: string | null;
}

export interface PublicDirectoryPage {
  items: PublicDirectoryResult[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Especialidad publicada en el directorio, con cuántos profesionales la
 * ejercen. Es un catálogo completo, no derivado de una página de resultados:
 * el filtro de la landing debe ofrecer todas las opciones existentes aunque la
 * primera página sólo muestre algunas.
 */
export interface PublicDirectorySpecialty {
  specialty: string;
  total: number;
}

export interface AvailabilitySlot {
  start: string;
  end: string;
  doctorId: string;
  doctorName: string;
}

export interface PublicPatientInput {
  nombre: string;
  fechaNacimiento: string;
  telefono: string;
  email?: string;
  canalPreferido: BookingChannel;
  whatsappOptIn: boolean;
  privacyNoticeAccepted: true;
  privacyNoticeVersion: string;
}

export interface CreatePublicAppointmentRequest {
  serviceId: string;
  doctorId?: string;
  start: string;
  patient: PublicPatientInput;
}

export interface PublicAppointmentSummary {
  clinicName: string;
  doctorName: string;
  start: string;
  end: string;
  status: AppointmentStatus;
  confirmationStatus: ConfirmationStatus;
  manageUrl?: string;
}

export interface MessagingDelivery {
  id: string;
  appointmentId: string;
  channel: 'whatsapp' | 'email';
  kind: 'confirmation' | 'reminder' | 'rescheduled' | 'cancelled';
  status: string;
  scheduledAt: string;
  attempts: number;
  lastErrorCode: string | null;
}

export interface BookingMetrics {
  publicBookings: number;
  delivered: number;
  confirmed: number;
  cancelled: number;
  rescheduled: number;
  noShows: number;
}

// ── Reportes ─────────────────────────────────────────────────────

export interface DiagnosticoFrecuente {
  cie10: string;
  descripcion: string;
  total: number;
}

export interface ProductividadMedico {
  doctorId: string;
  doctorNombre: string;
  consultas: number;
  tiempoPromedioMin: number | null;
}

export interface TendenciaMensual {
  mes: string; // YYYY-MM
  label: string; // "Ene 2026"
  total: number;
}

export interface ReportsStats {
  diagnosticosFrecuentes: DiagnosticoFrecuente[];
  productividadMedicos: ProductividadMedico[];
  tendenciaMensual: TendenciaMensual[]; // últimos 6 meses
}

// ─── Facturación (CFDI 4.0) ───────────────────────────────────────

export type FacturaEstatus = 'PENDIENTE' | 'TIMBRADA' | 'CANCELADA' | 'ERROR';

/** Consulta médica de médico titulado: EXENTO (art. 15 LIVA). */
export type TratamientoIva = 'EXENTO' | 'TASA_16' | 'TASA_0';

/** Motivos de cancelación del catálogo SAT. */
export type MotivoCancelacionSat = '01' | '02' | '03' | '04';

export interface ConceptoFacturaView {
  claveProdServ: string;
  claveUnidad: string;
  descripcion: string;
  cantidad: number;
  valorUnitario: string; // pesos "1234.50"
  importe: string;
  tratamientoIva: TratamientoIva;
}

export interface FacturaView {
  id: string;
  appointmentId: string;
  estatus: FacturaEstatus;
  uuidFiscal: string | null;
  subtotal: string; // pesos "1234.50" — SIEMPRE calculado server-side
  iva: string;
  total: string;
  motivoCancelacion: string | null;
  timbradaEn: string | null;
  canceladaEn: string | null;
  conceptos: ConceptoFacturaView[];
}

export interface TimbrarFacturaRequest {
  appointmentId: string;
  receptor: {
    rfc: string;
    razonSocial: string;
    regimenFiscal: string;
    codigoPostal: string;
    usoCfdi: string;
  };
  conceptos: {
    claveProdServ: string;
    claveUnidad: string;
    descripcion: string;
    cantidad: number;
    valorUnitario: number; // pesos
    tratamientoIva?: TratamientoIva;
  }[];
}

export interface CancelarFacturaRequest {
  motivo: MotivoCancelacionSat;
}

// ─── Finanzas (solo médico/admin) ────────────────────────────────

export interface FacturaListItem {
  id: string;
  pacienteNombre: string;
  fecha: string; // ISO (timbrada_en, o created_at si nunca timbró)
  estatus: FacturaEstatus;
  uuidFiscal: string | null;
  total: string; // pesos "1234.50"
  motivoCancelacion: string | null;
}

export interface IngresoMensual {
  mes: string; // YYYY-MM
  label: string; // "Ene 2026"
  total: number; // pesos (número para graficar)
}

export interface FinanzasResumen {
  /** Suma de facturas TIMBRADAS (las canceladas no cuentan como ingreso). */
  facturadoMes: string;
  facturadoAnio: string;
  facturasMes: number;
  canceladasMes: number;
  ingresosPorMes: IngresoMensual[]; // últimos 6 meses
  facturas: FacturaListItem[]; // más recientes primero
}

// ─── Notificaciones (campanita in-app) ───────────────────────────
export const NOTIFICATION_TYPES = [
  'cita_proxima',
  'cita_cancelada',
  'checkin',
  'factura_error',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationView {
  id: string;
  tipo: NotificationType;
  titulo: string;
  mensaje: string;
  appointmentId: string | null;
  leidaAt: string | null; // ISO datetime, o null si no se ha leído
  createdAt: string; // ISO datetime
}

export const NOTIFICATION_EVENTS = {
  /** El servidor emite esto cuando se crea una notificación para ESE usuario. */
  NEW: 'notification.new',
} as const;

export interface NotificationCreatedEvent {
  notification: NotificationView;
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * Catálogo de especialidades: la ÚNICA fuente de verdad de cómo se
 * personaliza la nota clínica.
 *
 * Todo lo específico de una especialidad —qué signos vitales pide, cómo se
 * llaman sus campos, qué bloques extra tiene y qué códigos CIE-10 le importan—
 * vive aquí como DATOS. Ni el backend ni el frontend ramifican por especialidad:
 * ambos leen el perfil y renderizan/validan lo que diga.
 *
 * Agregar una especialidad = agregar una entrada a PERFILES. Cero código nuevo.
 * ═══════════════════════════════════════════════════════════════════
 */

export const ESPECIALIDADES = [
  'general',
  'odontologia',
  'pediatria',
  'ginecologia_obstetricia',
  'medicina_interna',
  'traumatologia_ortopedia',
  'dermatologia',
  'cardiologia',
  'oftalmologia',
  'otorrinolaringologia',
  'psiquiatria',
  'endocrinologia',
  'nutricion',
  'heridas_estomas',
  'podologia',
] as const;

export type EspecialidadKey = (typeof ESPECIALIDADES)[number];

/** Campos de la nota base (NOM-004) cuya etiqueta puede reescribir una especialidad. */
export type CampoBaseKey = 'padecimientoActual' | 'hallazgos' | 'planTerapeutico' | 'diagnosticos';

export interface CampoExtra {
  /**
   * Clave estable. NUNCA se renombra ni se reutiliza: es la llave con la que
   * quedó guardado el valor dentro del `jsonb` de notas ya firmadas.
   */
  key: string;
  label: string;
  /**
   * 'multi-seleccion' = casillas de verificación (varias a la vez), como el
   * checklist de antecedentes patológicos en papel. Se guarda como STRING
   * —las opciones marcadas, unidas por coma— y no como arreglo, para no
   * cambiar la forma de `extension` (`Record<string, string | number | null>`)
   * solo por un tipo de campo. Vacío = ninguna marcada, igual que 'sano' en el
   * odontograma: la ausencia de marca no se guarda como ruido.
   */
  tipo: 'texto' | 'texto-rico' | 'numero' | 'seleccion' | 'multi-seleccion';
  opciones?: readonly string[];
  unidad?: string;
  /** Límites clínicos del control numérico; también se validan al cerrar y al transcribir. */
  min?: number;
  max?: number;
  step?: number;
  /** Si es true, el cierre de la nota lo exige (además de la base NOM-004). */
  obligatorio?: boolean;
  ayuda?: string;
  /**
   * Solo se pregunta en la HISTORIA CLÍNICA (primera visita).
   *
   * Existe porque una historia clínica completa —ocupación, cómo inició el
   * padecimiento, circunstancia desencadenante— se levanta UNA vez, y repetir
   * esos campos en cada consulta de seguimiento convierte una nota de control
   * de tres minutos en un formulario de treinta campos. El dato ya está en el
   * expediente; volver a pedirlo no lo mejora, solo hace que se llene peor.
   *
   * Con `obligatorio`, la exigencia también se levanta en las subsecuentes: un
   * campo que no se muestra no puede bloquear el cierre de la nota.
   */
  soloHistoriaClinica?: boolean;
}

/**
 * Campos que aplican al tipo de nota dado. Es la ÚNICA función que decide si un
 * campo de primera visita se muestra, y la comparten la pantalla y el validador
 * — si cada uno lo resolviera por su cuenta, un campo oculto podría acabar
 * impidiendo cerrar la nota, que es el peor resultado posible.
 */
export function camposDeNota(
  campos: readonly CampoExtra[],
  tipoNota: ClinicalNoteType,
): readonly CampoExtra[] {
  return tipoNota === 'historia_clinica'
    ? campos
    : campos.filter((c) => c.soloHistoriaClinica !== true);
}

export interface RangoCie10 {
  /** Inclusive, formato de 3 caracteres: 'K00'. */
  desde: string;
  /** Inclusive: 'K14'. */
  hasta: string;
}

export interface PerfilEspecialidad {
  key: EspecialidadKey;
  nombre: string;
  /**
   * Rangos de código que se PRIORIZAN en la búsqueda de diagnósticos — no
   * restringen. Un dentista debe poder codificar la diabetes que condiciona el
   * tratamiento periodontal; filtrar de verdad lo obligaría a codificar mal.
   * Vacío = sin preferencia (el catálogo completo, en su orden natural).
   */
  rangosCie10: readonly RangoCie10[];
  /** Reescribe etiquetas y placeholders de los campos base. */
  etiquetas?: Partial<Record<CampoBaseKey, { label: string; placeholder?: string }>>;
  /**
   * Signos vitales relevantes, en el orden en que se muestran. 'ta' va siempre:
   * es obligatorio por NOM-004 para cualquier especialidad.
   */
  signosVitales: readonly (keyof SignosVitales)[];
  camposExtra: readonly CampoExtra[];
  /**
   * Permite cerrar la nota SIN tensión arterial, marcando explícitamente que no
   * se tomó. Va por especialidad y no de forma global a propósito: NOM-004
   * exige T/A para todos, y abrir la puerta en general vaciaría el requisito.
   *
   * Ojo: no vuelve el campo "opcional" en el sentido de poder ignorarlo. Obliga
   * a declarar la omisión, que queda guardada en la nota — un expediente con un
   * hueco sin explicación no defiende a nadie; uno que dice "no se tomaron y por
   * esto", sí.
   */
  permiteOmitirSignosVitales?: boolean;
}

const VITALES_COMPLETOS = ['ta', 'fc', 'fr', 'temp', 'spo2', 'peso', 'talla'] as const;

/**
 * Complementos de la nota ambulatoria que comparten las especialidades médicas.
 *
 * Se mantienen opcionales: documentan los apartados que suelen faltar en una
 * nota breve (estudios, pronóstico y seguimiento) sin volver imposible cerrar
 * una consulta en la que no aplican. Odontología y podiatría conservan sus
 * flujos propios y NO incluyen este bloque.
 */
const CAMPOS_NOTA_MEDICA_COMPLEMENTARIOS: readonly CampoExtra[] = [
  {
    key: 'com_resultados_estudios',
    label: 'Resultados relevantes de estudios',
    tipo: 'texto-rico',
    ayuda: 'Laboratorio, gabinete o pruebas revisadas en esta consulta, con fecha cuando se conozca.',
  },
  {
    key: 'com_pronostico',
    label: 'Pronóstico',
    tipo: 'texto',
    ayuda: 'Pronóstico clínico y funcional, condicionado al diagnóstico y a la respuesta esperada.',
  },
  {
    key: 'com_seguimiento',
    label: 'Seguimiento y signos de alarma',
    tipo: 'texto-rico',
    ayuda: 'Plazo de revisión, criterios para adelantarla y referencias indicadas.',
  },
];

export const PERFILES: Record<EspecialidadKey, PerfilEspecialidad> = {
  /**
   * El default y la salida de emergencia: la nota exactamente como era antes de
   * existir este catálogo, con el catálogo CIE-10 completo. Toda nota cuya
   * especialidad no se reconozca cae aquí (ver perfilDe).
   */
  general: {
    key: 'general',
    nombre: 'Medicina general',
    rangosCie10: [],
    signosVitales: VITALES_COMPLETOS,
    camposExtra: [
      ...CAMPOS_NOTA_MEDICA_COMPLEMENTARIOS,
      {
        key: 'gen_conciliacion_medicamentos',
        label: 'Conciliación de medicamentos',
        tipo: 'texto-rico',
        ayuda: 'Nombre, dosis, vía y frecuencia; incluye medicamentos sin receta y suplementos relevantes.',
      },
      {
        key: 'gen_alergias_revisadas',
        label: 'Alergias revisadas',
        tipo: 'seleccion',
        opciones: ['Sin alergias conocidas', 'Confirmadas sin cambios', 'Actualizadas en esta consulta', 'No fue posible verificar'],
      },
    ],
  },

  /**
   * Odontología es el caso más distinto de todos, y no por gusto: las notas
   * dentales en México se rigen por la NOM-013-SSA2-2015, que exige signos
   * vitales en CADA cita y que el tratamiento asiente principio activo, dosis,
   * vía, frecuencia y duración. De ahí los campos obligatorios de abajo.
   *
   * El odontograma visual (nomenclatura FDI, por pieza y por cara) llega en la
   * fase 2; mientras tanto las piezas tratadas se capturan como texto FDI.
   */
  odontologia: {
    key: 'odontologia',
    nombre: 'Odontología',
    rangosCie10: [{ desde: 'K00', hasta: 'K14' }],
    /**
     * Solo T/A y FC, y no por ahorrar espacio: son los dos que condicionan la
     * anestesia. El anestésico dental lleva epinefrina como vasoconstrictor,
     * que en un hipertenso no controlado es un riesgo real — medir la presión
     * antes de infiltrar es protocolo, no trámite, y la NOM-013 exige signos
     * vitales al inicio de CADA cita. Frecuencia respiratoria y temperatura no
     * son rutina en odontología, así que solo estorbaban.
     */
    signosVitales: ['ta', 'fc'],
    // Válvula de escape para la consulta dental corta (una revisión, un
    // ajuste de ortodoncia) donde no hay procedimiento invasivo ni anestesia.
    // Exige declararlo, no lo deja pasar en blanco.
    permiteOmitirSignosVitales: true,
    etiquetas: {
      padecimientoActual: {
        label: 'Motivo de consulta y padecimiento actual',
        placeholder: 'Dolor, sangrado, tiempo de evolución, tratamientos dentales previos…',
      },
      hallazgos: {
        label: 'Exploración bucal',
        placeholder: 'Tejidos blandos, encías, oclusión, ATM, higiene bucal…',
      },
      planTerapeutico: {
        label: 'Plan de tratamiento e indicaciones',
        placeholder:
          'Medicamento (principio activo), dosis, vía, frecuencia y duración. Indicaciones post-operatorias.',
      },
    },
    camposExtra: [
      {
        key: 'odo_piezas_tratadas',
        label: 'Piezas tratadas (FDI)',
        tipo: 'texto',
        obligatorio: true,
        ayuda: 'Notación FDI de dos dígitos, separadas por coma. Ej: 16, 26, 36',
      },
      {
        key: 'odo_tratamiento_sesion',
        label: 'Tratamiento realizado en esta sesión',
        tipo: 'texto-rico',
        obligatorio: true,
      },
      { key: 'odo_cpod_cariados', label: 'CPOD · Cariados', tipo: 'numero' },
      { key: 'odo_cpod_perdidos', label: 'CPOD · Perdidos', tipo: 'numero' },
      { key: 'odo_cpod_obturados', label: 'CPOD · Obturados', tipo: 'numero' },
      {
        key: 'odo_higiene',
        label: 'Higiene bucal',
        tipo: 'seleccion',
        opciones: ['Buena', 'Regular', 'Deficiente'],
      },
      { key: 'odo_indicaciones_post', label: 'Indicaciones post-operatorias', tipo: 'texto-rico' },
    ],
  },

  pediatria: {
    key: 'pediatria',
    nombre: 'Pediatría',
    // Sin rangos: un pediatra ve patología de todos los capítulos. Lo que
    // cambia es qué mide y qué registra, no qué codifica.
    rangosCie10: [],
    signosVitales: VITALES_COMPLETOS,
    etiquetas: {
      padecimientoActual: {
        label: 'Padecimiento actual',
        placeholder: 'Incluye antecedentes perinatales relevantes y evolución…',
      },
    },
    camposExtra: [
      ...CAMPOS_NOTA_MEDICA_COMPLEMENTARIOS,
      { key: 'ped_perimetro_cefalico', label: 'Perímetro cefálico', tipo: 'numero', unidad: 'cm' },
      { key: 'ped_percentil_peso', label: 'Percentil de peso', tipo: 'numero', unidad: '%' },
      { key: 'ped_percentil_talla', label: 'Percentil de talla', tipo: 'numero', unidad: '%' },
      { key: 'ped_percentil_imc', label: 'Percentil de IMC', tipo: 'numero', unidad: '%' },
      {
        key: 'ped_esquema_vacunacion',
        label: 'Esquema de vacunación',
        tipo: 'seleccion',
        opciones: ['Completo para la edad', 'Incompleto', 'Se desconoce'],
        obligatorio: true,
      },
      { key: 'ped_desarrollo', label: 'Desarrollo psicomotor', tipo: 'texto-rico' },
      { key: 'ped_alimentacion', label: 'Alimentación', tipo: 'texto' },
      {
        key: 'ped_tamizaje_desarrollo',
        label: 'Tamizaje de desarrollo o conducta',
        tipo: 'texto-rico',
        ayuda: 'Instrumento, fecha, resultado, interpretación y acción derivada.',
      },
      {
        key: 'ped_orientacion_anticipatoria',
        label: 'Orientación anticipatoria',
        tipo: 'texto-rico',
        ayuda: 'Prevención, seguridad, alimentación y temas acordes con la edad.',
      },
    ],
  },

  ginecologia_obstetricia: {
    key: 'ginecologia_obstetricia',
    nombre: 'Ginecología y obstetricia',
    rangosCie10: [
      { desde: 'N70', hasta: 'N98' },
      { desde: 'O00', hasta: 'O99' },
      { desde: 'Z30', hasta: 'Z39' },
    ],
    signosVitales: VITALES_COMPLETOS,
    camposExtra: [
      ...CAMPOS_NOTA_MEDICA_COMPLEMENTARIOS,
      { key: 'gin_fum', label: 'Fecha de última menstruación', tipo: 'texto' },
      { key: 'gin_fpp', label: 'Fecha probable de parto', tipo: 'texto' },
      { key: 'gin_gestas', label: 'Gestas', tipo: 'numero' },
      { key: 'gin_partos', label: 'Partos', tipo: 'numero' },
      { key: 'gin_cesareas', label: 'Cesáreas', tipo: 'numero' },
      { key: 'gin_abortos', label: 'Abortos', tipo: 'numero' },
      { key: 'gin_sdg', label: 'Semanas de gestación', tipo: 'numero', unidad: 'SDG' },
      { key: 'gin_dias_gestacion', label: 'Días adicionales de gestación', tipo: 'numero', unidad: 'días' },
      { key: 'gin_altura_uterina', label: 'Altura uterina', tipo: 'numero', unidad: 'cm' },
      { key: 'gin_fcf', label: 'Frecuencia cardiaca fetal', tipo: 'numero', unidad: 'lpm' },
      { key: 'gin_movimientos_fetales', label: 'Movimientos fetales', tipo: 'texto' },
      {
        key: 'gin_datos_alarma_obstetrica',
        label: 'Datos de alarma obstétrica',
        tipo: 'texto-rico',
        ayuda: 'Sangrado, pérdida de líquido, contracciones, cefalea, fosfenos u otros síntomas relevantes.',
      },
      { key: 'gin_metodo_planificacion', label: 'Método de planificación', tipo: 'texto' },
      {
        key: 'gin_antecedentes_obstetricos',
        label: 'Antecedentes obstétricos detallados',
        tipo: 'texto-rico',
        soloHistoriaClinica: true,
        ayuda: 'Edad gestacional, vía de resolución, peso neonatal y complicaciones de cada embarazo.',
      },
    ],
  },

  medicina_interna: {
    key: 'medicina_interna',
    nombre: 'Medicina interna',
    rangosCie10: [],
    signosVitales: VITALES_COMPLETOS,
    camposExtra: [
      ...CAMPOS_NOTA_MEDICA_COMPLEMENTARIOS,
      { key: 'mi_comorbilidades', label: 'Comorbilidades', tipo: 'texto-rico' },
      { key: 'mi_medicacion_cronica', label: 'Medicación crónica actual', tipo: 'texto-rico' },
      {
        key: 'mi_lista_problemas',
        label: 'Evaluación por problema',
        tipo: 'texto-rico',
        ayuda: 'Estado, evidencia, objetivo y plan para cada problema activo.',
      },
      { key: 'mi_estado_funcional', label: 'Estado funcional', tipo: 'texto-rico' },
      {
        key: 'mi_conciliacion_medicamentos',
        label: 'Conciliación de medicamentos',
        tipo: 'texto-rico',
        ayuda: 'Nombre, dosis, vía, frecuencia, adherencia y cambios realizados.',
      },
    ],
  },

  traumatologia_ortopedia: {
    key: 'traumatologia_ortopedia',
    nombre: 'Traumatología y ortopedia',
    rangosCie10: [
      { desde: 'M00', hasta: 'M99' },
      { desde: 'S00', hasta: 'T14' },
    ],
    signosVitales: ['ta', 'fc', 'temp'],
    etiquetas: {
      hallazgos: {
        label: 'Exploración musculoesquelética',
        placeholder: 'Inspección, palpación, arcos de movilidad, maniobras, estado neurovascular…',
      },
    },
    camposExtra: [
      ...CAMPOS_NOTA_MEDICA_COMPLEMENTARIOS,
      { key: 'tra_region', label: 'Región anatómica', tipo: 'texto', obligatorio: true },
      {
        key: 'tra_lateralidad',
        label: 'Lateralidad',
        tipo: 'seleccion',
        opciones: ['Derecha', 'Izquierda', 'Bilateral', 'No aplica'],
      },
      { key: 'tra_fecha_lesion', label: 'Fecha de lesión o inicio', tipo: 'texto' },
      { key: 'tra_mecanismo_lesion', label: 'Mecanismo de lesión', tipo: 'texto-rico' },
      { key: 'tra_dolor_eva', label: 'Dolor (EVA)', tipo: 'numero', unidad: '/10' },
      { key: 'tra_inspeccion_palpacion', label: 'Inspección y palpación', tipo: 'texto-rico' },
      { key: 'tra_arcos_movilidad', label: 'Arcos de movilidad', tipo: 'texto' },
      { key: 'tra_fuerza', label: 'Fuerza muscular', tipo: 'texto' },
      { key: 'tra_pruebas_especiales', label: 'Pruebas y maniobras especiales', tipo: 'texto-rico' },
      {
        key: 'tra_estado_neurovascular',
        label: 'Estado neurovascular distal',
        tipo: 'texto-rico',
        ayuda: 'Sensibilidad, movilidad, pulsos y llenado capilar distales.',
      },
      { key: 'tra_estudios_imagen', label: 'Estudios de imagen e interpretación', tipo: 'texto-rico' },
      { key: 'tra_restricciones', label: 'Carga, inmovilización y restricciones', tipo: 'texto-rico' },
    ],
  },

  dermatologia: {
    key: 'dermatologia',
    nombre: 'Dermatología',
    rangosCie10: [{ desde: 'L00', hasta: 'L99' }],
    signosVitales: ['ta', 'fc', 'temp'],
    etiquetas: {
      hallazgos: {
        label: 'Exploración dermatológica',
        placeholder: 'Topografía, morfología, distribución de las lesiones…',
      },
    },
    camposExtra: [
      ...CAMPOS_NOTA_MEDICA_COMPLEMENTARIOS,
      { key: 'der_topografia', label: 'Topografía de la lesión', tipo: 'texto', obligatorio: true },
      { key: 'der_morfologia', label: 'Morfología', tipo: 'texto' },
      { key: 'der_distribucion', label: 'Distribución', tipo: 'texto' },
      { key: 'der_numero_tamano', label: 'Número y tamaño de lesiones', tipo: 'texto' },
      { key: 'der_evolucion_sintomas', label: 'Evolución y síntomas', tipo: 'texto-rico' },
      { key: 'der_exposiciones', label: 'Exposiciones y desencadenantes', tipo: 'texto-rico' },
      { key: 'der_fototipo', label: 'Fototipo (Fitzpatrick)', tipo: 'seleccion', opciones: ['I', 'II', 'III', 'IV', 'V', 'VI'] },
      { key: 'der_dermatoscopia', label: 'Dermatoscopia', tipo: 'texto-rico' },
      { key: 'der_abcde', label: 'Evaluación ABCDE', tipo: 'texto-rico' },
      { key: 'der_diagnostico_diferencial', label: 'Diagnóstico diferencial', tipo: 'texto-rico' },
      { key: 'der_biopsia', label: 'Biopsia o procedimiento', tipo: 'texto-rico' },
      {
        key: 'der_fotografia_consentimiento',
        label: 'Fotografía clínica',
        tipo: 'seleccion',
        opciones: ['No realizada', 'Realizada con consentimiento', 'Realizada sin identificar al paciente'],
      },
    ],
  },

  cardiologia: {
    key: 'cardiologia',
    nombre: 'Cardiología',
    rangosCie10: [{ desde: 'I00', hasta: 'I99' }],
    signosVitales: VITALES_COMPLETOS,
    camposExtra: [
      ...CAMPOS_NOTA_MEDICA_COMPLEMENTARIOS,
      {
        key: 'car_clase_funcional',
        label: 'Clase funcional (NYHA)',
        tipo: 'seleccion',
        opciones: ['I', 'II', 'III', 'IV'],
      },
      { key: 'car_ta_brazo_der', label: 'T/A brazo derecho', tipo: 'texto' },
      { key: 'car_ta_brazo_izq', label: 'T/A brazo izquierdo', tipo: 'texto' },
      { key: 'car_sintomas', label: 'Síntomas cardiovasculares', tipo: 'texto-rico', ayuda: 'Dolor torácico, disnea, ortopnea, edema, síncope y palpitaciones.' },
      { key: 'car_exploracion', label: 'Exploración cardiovascular', tipo: 'texto-rico', ayuda: 'Ritmo, soplos, ingurgitación yugular, pulsos y edema.' },
      { key: 'car_ecg', label: 'Electrocardiograma', tipo: 'texto-rico', ayuda: 'Fecha, ritmo, frecuencia, intervalos y hallazgos relevantes.' },
      { key: 'car_fraccion_eyeccion', label: 'Fracción de eyección', tipo: 'numero', unidad: '%' },
      { key: 'car_riesgo', label: 'Factores de riesgo cardiovascular', tipo: 'texto-rico' },
      { key: 'car_riesgo_ascvd', label: 'Riesgo cardiovascular calculado', tipo: 'texto' },
      { key: 'car_adherencia', label: 'Adherencia, tolerancia y contraindicaciones', tipo: 'texto-rico' },
    ],
  },

  oftalmologia: {
    key: 'oftalmologia',
    nombre: 'Oftalmología',
    rangosCie10: [{ desde: 'H00', hasta: 'H59' }],
    signosVitales: ['ta', 'fc'],
    camposExtra: [
      ...CAMPOS_NOTA_MEDICA_COMPLEMENTARIOS,
      { key: 'oft_agudeza_od', label: 'Agudeza visual OD', tipo: 'texto', obligatorio: true },
      { key: 'oft_agudeza_oi', label: 'Agudeza visual OI', tipo: 'texto', obligatorio: true },
      { key: 'oft_metodo_correccion', label: 'Método y corrección de agudeza visual', tipo: 'texto', ayuda: 'Distancia, cartilla, sin/con corrección y agujero estenopeico.' },
      { key: 'oft_presion_od', label: 'Presión intraocular OD', tipo: 'numero', unidad: 'mmHg' },
      { key: 'oft_presion_oi', label: 'Presión intraocular OI', tipo: 'numero', unidad: 'mmHg' },
      { key: 'oft_pupilas_rapd', label: 'Pupilas y RAPD', tipo: 'texto' },
      { key: 'oft_motilidad_alineacion', label: 'Motilidad y alineación', tipo: 'texto' },
      { key: 'oft_campos_visuales', label: 'Campos visuales', tipo: 'texto' },
      { key: 'oft_vision_color', label: 'Visión de color', tipo: 'texto' },
      { key: 'oft_examen_externo', label: 'Examen externo', tipo: 'texto-rico' },
      { key: 'oft_segmento_anterior', label: 'Segmento anterior', tipo: 'texto-rico' },
      { key: 'oft_fondo_ojo', label: 'Fondo de ojo', tipo: 'texto-rico' },
      { key: 'oft_nervio_copa_disco', label: 'Nervio óptico y relación copa/disco', tipo: 'texto' },
      { key: 'oft_macula_periferia', label: 'Mácula y retina periférica', tipo: 'texto-rico' },
      { key: 'oft_estudios', label: 'OCT, campimetría y otros estudios', tipo: 'texto-rico' },
      { key: 'oft_dilatacion', label: 'Dilatación', tipo: 'texto', ayuda: 'Fármacos, concentración y hora cuando se realizó.' },
    ],
  },

  otorrinolaringologia: {
    key: 'otorrinolaringologia',
    nombre: 'Otorrinolaringología',
    rangosCie10: [
      { desde: 'H60', hasta: 'H95' },
      { desde: 'J30', hasta: 'J39' },
    ],
    signosVitales: ['ta', 'fc', 'temp'],
    camposExtra: [
      ...CAMPOS_NOTA_MEDICA_COMPLEMENTARIOS,
      { key: 'orl_lateralidad', label: 'Lateralidad', tipo: 'seleccion', opciones: ['Derecha', 'Izquierda', 'Bilateral', 'No aplica'] },
      { key: 'orl_otoscopia', label: 'Otoscopia', tipo: 'texto-rico' },
      { key: 'orl_membrana_timpanica', label: 'Membrana timpánica y movilidad', tipo: 'texto-rico' },
      { key: 'orl_weber_rinne', label: 'Weber y Rinne', tipo: 'texto' },
      { key: 'orl_rinoscopia', label: 'Rinoscopia', tipo: 'texto-rico' },
      { key: 'orl_faringe', label: 'Orofaringe', tipo: 'texto' },
      { key: 'orl_cuello', label: 'Cuello', tipo: 'texto-rico' },
      { key: 'orl_voz_deglucion_via_aerea', label: 'Voz, deglución y vía aérea', tipo: 'texto-rico' },
      { key: 'orl_audiometria', label: 'Audiometría', tipo: 'texto-rico' },
      { key: 'orl_nasofibroscopia', label: 'Nasofibroscopia o laringoscopia', tipo: 'texto-rico', ayuda: 'Indicación, anestésico/descongestionante, estructuras examinadas y hallazgos.' },
    ],
  },

  psiquiatria: {
    key: 'psiquiatria',
    nombre: 'Psiquiatría',
    rangosCie10: [{ desde: 'F00', hasta: 'F99' }],
    // Deliberadamente mínimo: en una consulta psiquiátrica tomar la tensión no
    // es rutina, pero NOM-004 exige T/A para cerrar, así que se queda.
    signosVitales: ['ta', 'fc', 'peso'],
    etiquetas: {
      hallazgos: {
        label: 'Examen mental',
        placeholder: 'Apariencia, conciencia, atención, afecto, pensamiento, juicio…',
      },
    },
    camposExtra: [
      ...CAMPOS_NOTA_MEDICA_COMPLEMENTARIOS,
      { key: 'psi_examen_mental', label: 'Examen mental', tipo: 'texto-rico', obligatorio: true },
      {
        key: 'psi_riesgo_suicida',
        label: 'Riesgo suicida',
        tipo: 'seleccion',
        opciones: ['Ausente', 'Leve', 'Moderado', 'Alto'],
        obligatorio: true,
        ayuda: 'Su registro en cada consulta es un respaldo médico-legal.',
      },
      { key: 'psi_ideacion_plan_intencion', label: 'Ideación, plan e intención suicida', tipo: 'texto-rico' },
      { key: 'psi_acceso_medios', label: 'Acceso a medios', tipo: 'texto' },
      { key: 'psi_factores_riesgo_proteccion', label: 'Factores de riesgo y protección', tipo: 'texto-rico' },
      { key: 'psi_autolesion_violencia', label: 'Autolesión y riesgo de violencia', tipo: 'texto-rico' },
      { key: 'psi_escalas', label: 'Escalas clínicas', tipo: 'texto-rico', ayuda: 'Instrumento, fecha, puntuación e interpretación.' },
      { key: 'psi_adherencia', label: 'Adherencia al tratamiento', tipo: 'texto' },
      { key: 'psi_respuesta_efectos_adversos', label: 'Respuesta y efectos adversos', tipo: 'texto-rico' },
      { key: 'psi_consumo_sustancias', label: 'Consumo de sustancias', tipo: 'texto-rico' },
      { key: 'psi_plan_seguridad', label: 'Plan de seguridad y red de apoyo', tipo: 'texto-rico' },
    ],
  },

  endocrinologia: {
    key: 'endocrinologia',
    nombre: 'Endocrinología',
    rangosCie10: [{ desde: 'E00', hasta: 'E90' }],
    signosVitales: VITALES_COMPLETOS,
    camposExtra: [
      ...CAMPOS_NOTA_MEDICA_COMPLEMENTARIOS,
      { key: 'end_imc', label: 'IMC', tipo: 'numero', unidad: 'kg/m²' },
      { key: 'end_circunferencia_cintura', label: 'Circunferencia de cintura', tipo: 'numero', unidad: 'cm' },
      { key: 'end_glucosa', label: 'Glucosa', tipo: 'numero', unidad: 'mg/dL' },
      { key: 'end_hba1c', label: 'HbA1c', tipo: 'numero', unidad: '%' },
      { key: 'end_objetivos_metabolicos', label: 'Objetivos metabólicos individualizados', tipo: 'texto-rico' },
      { key: 'end_hipoglucemia', label: 'Hipoglucemia y riesgo asociado', tipo: 'texto-rico' },
      { key: 'end_complicaciones', label: 'Complicaciones y comorbilidades', tipo: 'texto-rico' },
      { key: 'end_funcion_renal', label: 'Función renal y albuminuria', tipo: 'texto-rico' },
      { key: 'end_retina_neuropatia', label: 'Retinopatía y neuropatía', tipo: 'texto-rico' },
      { key: 'end_pies_diabeticos', label: 'Exploración de pies', tipo: 'texto-rico', ayuda: 'Integridad de piel, deformidades, pulsos, sensibilidad y monofilamento de 10 g.' },
      { key: 'end_dispositivos', label: 'Monitoreo y dispositivos', tipo: 'texto-rico', ayuda: 'Glucómetro, CGM, bomba, tiempo en rango y revisión de datos.' },
    ],
  },

  nutricion: {
    key: 'nutricion',
    nombre: 'Nutrición',
    rangosCie10: [
      { desde: 'E40', hasta: 'E68' },
      { desde: 'Z71', hasta: 'Z71' },
    ],
    signosVitales: ['ta', 'peso', 'talla'],
    etiquetas: {
      planTerapeutico: { label: 'Plan nutricional', placeholder: 'Aporte calórico, distribución de macronutrientes, recomendaciones…' },
    },
    camposExtra: [
      ...CAMPOS_NOTA_MEDICA_COMPLEMENTARIOS,
      { key: 'nut_imc', label: 'IMC', tipo: 'numero', unidad: 'kg/m²' },
      { key: 'nut_porcentaje_grasa', label: 'Porcentaje de grasa', tipo: 'numero', unidad: '%' },
      { key: 'nut_masa_muscular', label: 'Masa muscular', tipo: 'numero', unidad: 'kg' },
      { key: 'nut_circunferencia_cintura', label: 'Circunferencia de cintura', tipo: 'numero', unidad: 'cm' },
      { key: 'nut_recordatorio_24h', label: 'Recordatorio de 24 horas', tipo: 'texto-rico' },
      { key: 'nut_objetivo', label: 'Objetivo del paciente', tipo: 'texto' },
      { key: 'nut_indicadores_bioquimicos', label: 'Indicadores bioquímicos', tipo: 'texto-rico' },
      { key: 'nut_actividad_conducta', label: 'Actividad física y conducta alimentaria', tipo: 'texto-rico' },
      {
        key: 'nut_diagnostico_pes',
        label: 'Diagnóstico nutricional (PES)',
        tipo: 'texto-rico',
        ayuda: 'Problema relacionado con etiología, evidenciado por signos y síntomas.',
      },
      { key: 'nut_prescripcion', label: 'Prescripción nutricional', tipo: 'texto-rico', ayuda: 'Energía, distribución de nutrimentos y estrategia acordada.' },
      { key: 'nut_metas_medibles', label: 'Metas medibles', tipo: 'texto-rico' },
      { key: 'nut_monitoreo_evaluacion', label: 'Monitoreo y evaluación', tipo: 'texto-rico', ayuda: 'Indicadores, resultado esperado y fecha de reevaluación.' },
    ],
  },

  /**
   * Valoración integral y seguimiento de heridas y estomas.
   *
   * Sigue la secuencia de la hoja clínica aportada por el consultorio:
   * paciente → herida → lecho → exudado/infección → borde/piel perilesional →
   * tratamiento. Los campos de estoma son opcionales para que el mismo perfil
   * atienda ambas líneas clínicas sin contaminar una valoración solo de herida.
   */
  heridas_estomas: {
    key: 'heridas_estomas',
    nombre: 'Clínica de heridas y estomas',
    rangosCie10: [
      { desde: 'L89', hasta: 'L89' },
      { desde: 'L97', hasta: 'L98' },
      { desde: 'S00', hasta: 'T14' },
      { desde: 'Z43', hasta: 'Z43' },
      { desde: 'Z93', hasta: 'Z93' },
    ],
    signosVitales: VITALES_COMPLETOS,
    etiquetas: {
      padecimientoActual: {
        label: 'Motivo de atención y evolución de la herida',
        placeholder:
          'Inicio, causa, evolución, tratamientos anteriores y cambios desde la última valoración…',
      },
      hallazgos: {
        label: 'Valoración integral de la herida o estoma',
        placeholder:
          'Localización, dimensiones, lecho, exudado, infección, bordes y piel circundante…',
      },
      planTerapeutico: {
        label: 'Plan de manejo de la herida',
        placeholder:
          'Limpieza, desbridamiento, apósito, descarga/compresión, frecuencia de curación e indicaciones…',
      },
    },
    camposExtra: [
      ...CAMPOS_NOTA_MEDICA_COMPLEMENTARIOS,

      // ── Valoración integral del paciente ────────────────────────
      { key: 'her_glucosa_capilar', label: 'Glucosa capilar', tipo: 'numero', unidad: 'mg/dL' },
      {
        key: 'her_estado_nutricional',
        label: 'Estado nutricional',
        tipo: 'seleccion',
        opciones: ['Normal', 'Bajo peso', 'Sobrepeso', 'Obesidad', 'No valorado'],
      },
      {
        key: 'her_movilidad',
        label: 'Estado de movilidad',
        tipo: 'seleccion',
        opciones: ['Independiente', 'Limitada', 'Postrado', 'No valorado'],
      },
      {
        key: 'her_tabaquismo',
        label: 'Tabaquismo',
        tipo: 'seleccion',
        opciones: ['No', 'Sí', 'Exfumador', 'No especificado'],
      },
      { key: 'her_cigarrillos_dia', label: 'Cigarrillos al día', tipo: 'numero' },
      { key: 'her_alcohol_semana', label: 'Consumo de alcohol', tipo: 'numero', unidad: 'veces/semana' },
      { key: 'her_patologia_base', label: 'Patología de base', tipo: 'texto-rico' },
      { key: 'her_comorbilidades', label: 'Comorbilidades', tipo: 'texto-rico' },
      {
        key: 'her_medicamentos',
        label: 'Medicamentos actuales',
        tipo: 'texto-rico',
        ayuda:
          'Incluye anticoagulantes, esteroides, antibióticos y fármacos que afecten la cicatrización.',
      },

      // ── Descripción y dimensiones ───────────────────────────────
      {
        key: 'her_identificador',
        label: 'Identificador de la herida',
        tipo: 'texto',
        ayuda: 'Permite distinguirla cuando el paciente tiene más de una herida.',
      },
      {
        key: 'her_tipo',
        label: 'Tipo de herida',
        tipo: 'seleccion',
        opciones: [
          'Por presión',
          'Venosa',
          'Arterial',
          'Pie diabético',
          'Quirúrgica',
          'Traumática',
          'Por humedad',
          'Quemadura',
          'Neoplásica',
          'Otra',
        ],
      },
      { key: 'her_duracion', label: 'Duración de la herida', tipo: 'texto' },
      { key: 'her_tratamientos_previos', label: 'Tratamientos anteriores', tipo: 'texto-rico' },
      {
        key: 'her_zona_corporal',
        label: 'Zona corporal',
        tipo: 'seleccion',
        opciones: [
          'Cabeza o cuello',
          'Tórax',
          'Abdomen',
          'Espalda',
          'Región sacra o glútea',
          'Extremidad superior',
          'Mano',
          'Cadera o muslo',
          'Rodilla o pierna',
          'Tobillo o talón',
          'Pie o dedos',
          'Otra',
        ],
      },
      {
        key: 'her_localizacion',
        label: 'Localización anatómica',
        tipo: 'texto',
        obligatorio: true,
      },
      {
        key: 'her_lateralidad',
        label: 'Lateralidad',
        tipo: 'seleccion',
        opciones: ['Derecha', 'Izquierda', 'Bilateral', 'Línea media', 'No aplica'],
      },
      { key: 'her_longitud', label: 'Longitud', tipo: 'numero', unidad: 'cm', min: 0, step: 0.1 },
      { key: 'her_ancho', label: 'Ancho', tipo: 'numero', unidad: 'cm', min: 0, step: 0.1 },
      { key: 'her_profundidad', label: 'Profundidad', tipo: 'numero', unidad: 'cm', min: 0, step: 0.1 },
      {
        key: 'her_socavacion_tuneles',
        label: 'Socavación, túneles o cavidades',
        tipo: 'texto',
        ayuda: 'Describe profundidad y posición con referencias horarias cuando aplique.',
      },
      { key: 'her_dolor_eva', label: 'Dolor (EVA)', tipo: 'numero', unidad: '/10', min: 0, max: 10 },
      {
        key: 'her_categoria_presion',
        label: 'Categoría de lesión por presión',
        tipo: 'seleccion',
        opciones: [
          'No aplica',
          'Categoría 1',
          'Categoría 2',
          'Categoría 3',
          'Categoría 4',
          'No clasificable',
          'Lesión de tejido profundo',
        ],
      },

      // ── Lecho y exudado ─────────────────────────────────────────
      { key: 'her_tejido_necrotico', label: 'Tejido necrótico', tipo: 'numero', unidad: '%', min: 0, max: 100 },
      { key: 'her_tejido_esfacelar', label: 'Tejido esfacelar', tipo: 'numero', unidad: '%', min: 0, max: 100 },
      {
        key: 'her_tejido_granulacion',
        label: 'Tejido de granulación',
        tipo: 'numero',
        unidad: '%',
        min: 0,
        max: 100,
      },
      { key: 'her_tejido_epitelial', label: 'Tejido epitelial', tipo: 'numero', unidad: '%', min: 0, max: 100 },
      {
        key: 'her_nivel_exudado',
        label: 'Nivel de exudado',
        tipo: 'seleccion',
        opciones: ['Nulo', 'Bajo', 'Moderado', 'Alto'],
      },
      {
        key: 'her_tipo_exudado',
        label: 'Tipo de exudado',
        tipo: 'seleccion',
        opciones: [
          'Acuoso',
          'Seroso',
          'Sanguinolento',
          'Serosanguinolento',
          'Espeso/turbio',
          'Purulento',
        ],
      },
      { key: 'her_olor', label: 'Olor', tipo: 'texto' },
      {
        key: 'her_datos_infeccion',
        label: 'Datos de infección o deterioro',
        tipo: 'multi-seleccion',
        opciones: [
          'Dolor aumentado',
          'Calor local',
          'Eritema',
          'Edema',
          'Exudado aumentado',
          'Mal olor',
          'Tejido friable',
          'Cicatrización detenida',
          'Cavitación',
          'Celulitis',
          'Fiebre o malestar sistémico',
        ],
      },

      // ── Borde y piel perilesional ───────────────────────────────
      {
        key: 'her_borde',
        label: 'Borde de la herida',
        tipo: 'multi-seleccion',
        opciones: ['Íntegro', 'Macerado', 'Deshidratado', 'Despegado', 'Engrosado', 'Enrollado'],
      },
      {
        key: 'her_piel_perilesional',
        label: 'Piel perilesional',
        tipo: 'multi-seleccion',
        opciones: [
          'Íntegra',
          'Macerada',
          'Excoriada',
          'Seca',
          'Hiperqueratósica',
          'Con callos',
          'Con eccema',
          'Con edema',
        ],
      },
      {
        key: 'her_extension_perilesional',
        label: 'Extensión de la afectación perilesional',
        tipo: 'numero',
        unidad: 'cm',
        min: 0,
        step: 0.1,
      },
      {
        key: 'her_evolucion',
        label: 'Evolución respecto a la valoración anterior',
        tipo: 'seleccion',
        opciones: ['Primera valoración', 'Mejoría', 'Sin cambio', 'Deterioro'],
      },
      {
        key: 'her_fotografia',
        label: 'Fotografía clínica',
        tipo: 'seleccion',
        opciones: ['No realizada', 'Realizada con consentimiento', 'No fue posible realizarla'],
      },

      // ── Curación y tratamiento ──────────────────────────────────
      {
        key: 'her_limpieza_desbridamiento',
        label: 'Limpieza y desbridamiento',
        tipo: 'texto-rico',
      },
      { key: 'her_aposito', label: 'Apósito primario y secundario', tipo: 'texto-rico' },
      { key: 'her_frecuencia_curacion', label: 'Frecuencia de curación', tipo: 'texto' },
      {
        key: 'her_manejo_causa',
        label: 'Manejo de la causa',
        tipo: 'texto-rico',
        ayuda:
          'Descarga, redistribución de presión, compresión, control vascular o metabólico.',
      },
      {
        key: 'her_educacion',
        label: 'Educación al paciente y cuidador',
        tipo: 'texto-rico',
      },

      // ── Estoma (solo cuando aplique) ────────────────────────────
      {
        key: 'est_tipo',
        label: 'Tipo de estoma',
        tipo: 'seleccion',
        opciones: [
          'No aplica',
          'Colostomía',
          'Ileostomía',
          'Urostomía',
          'Gastrostomía',
          'Traqueostomía',
          'Otro',
        ],
      },
      { key: 'est_localizacion', label: 'Localización del estoma', tipo: 'texto' },
      {
        key: 'est_apariencia',
        label: 'Apariencia, color y protrusión del estoma',
        tipo: 'texto-rico',
      },
      { key: 'est_union_mucocutanea', label: 'Unión mucocutánea', tipo: 'texto-rico' },
      { key: 'est_piel_periestomal', label: 'Piel periestomal', tipo: 'texto-rico' },
      {
        key: 'est_efluente',
        label: 'Efluente: tipo, cantidad y consistencia',
        tipo: 'texto-rico',
      },
      {
        key: 'est_dispositivo',
        label: 'Dispositivo, ajuste y tiempo de uso',
        tipo: 'texto-rico',
      },
      { key: 'est_fugas', label: 'Fugas y complicaciones', tipo: 'texto-rico' },
    ],
  },

  /**
   * Podología. El perfil sale de la historia clínica que usa hoy la Dra. en
   * papel, y su columna vertebral es el CRIBADO DE PIE DIABÉTICO: monofilamento
   * de Semmes-Weinstein y pulsos distales, por pie y por separado.
   *
   * Que vayan por pie —y no un campo "pulsos: normal"— no es burocracia: la
   * neuropatía y la arteriopatía son casi siempre ASIMÉTRICAS, y perder el
   * monofilamento en un solo pie es exactamente el hallazgo que decide si ese
   * paciente entra a vigilancia estrecha. Colapsar los dos pies en un campo
   * borraría el dato que justifica la consulta.
   *
   * Lo visual de esta especialidad —marcar lesiones sobre el mapa del pie y la
   * orden de plantillas— NO cabe en `camposExtra`, que es un mapa plano de
   * escalares. Va como instrumento estructurado aparte, igual que el
   * odontograma. Ver docs/adr/0001-instrumentos-graficos-especialidad.md.
   */
  podologia: {
    key: 'podologia',
    // Rótulo visible: la Dra. se anuncia como "Médico Podiatra", así que en
    // pantalla dice "Podiatría". La CLAVE se queda como 'podologia' a
    // propósito — va escrita en el jsonb de cada nota firmada y renombrarla
    // rompería expedientes históricos. Nombre y clave no tienen por qué
    // coincidir; solo el nombre se lee.
    nombre: 'Podiatría',
    rangosCie10: [
      // Deformidades del pie (hallux valgus M20.1, pie plano/cavo M21.4-M21.6).
      { desde: 'M20', hasta: 'M21' },
      // Tejidos blandos: fascitis plantar M72.2, espolón calcáneo M77.3.
      { desde: 'M70', hasta: 'M79' },
      // Onicopatías: uña encarnada L60.0, onicólisis L60.1, onicogrifosis L60.2.
      { desde: 'L60', hasta: 'L60' },
      // Heloma y callosidades.
      { desde: 'L84', hasta: 'L84' },
      // Micosis: onicomicosis B35.1, tiña del pie B35.3.
      { desde: 'B35', hasta: 'B35' },
      // Úlcera de miembro inferior — el desenlace que todo el cribado busca evitar.
      { desde: 'L97', hasta: 'L98' },
    ],
    signosVitales: VITALES_COMPLETOS,
    etiquetas: {
      padecimientoActual: {
        label: 'Motivo de consulta y padecimiento actual',
        placeholder:
          'Fecha del primer síntoma, localización, cómo inició, circunstancia desencadenante, tipo y frecuencia del dolor (diurno, nocturno, intermitente)…',
      },
      hallazgos: {
        label: 'Exploración podológica',
        placeholder:
          'Piel y anexos, uñas, estructura ósea, marcha, huella plantar, estado vascular y neurológico…',
      },
      planTerapeutico: {
        label: 'Tratamiento e indicaciones',
        placeholder:
          'Procedimiento realizado, curaciones, ortesis o plantillas indicadas, calzado recomendado y cuidados en casa.',
      },
    },
    camposExtra: [
      // ── Ficha de identificación (hoja 1). Solo primera visita. ──
      {
        key: 'pod_ocupacion_actual',
        label: 'Ocupación actual',
        tipo: 'texto',
        soloHistoriaClinica: true,
        ayuda: 'Cuántas horas de pie: es factor de carga directo sobre el pie.',
      },
      {
        key: 'pod_ocupacion_anterior',
        label: 'Ocupación anterior',
        tipo: 'texto',
        soloHistoriaClinica: true,
      },

      // ── Padecimiento actual (hoja 1). Se levanta una vez. ──
      {
        key: 'pod_fecha_primer_sintoma',
        label: 'Fecha del 1.er síntoma',
        tipo: 'texto',
        soloHistoriaClinica: true,
      },
      {
        key: 'pod_localizacion',
        label: 'Localización',
        tipo: 'texto',
        soloHistoriaClinica: true,
      },
      {
        key: 'pod_como_inicio',
        label: 'Cómo inició',
        tipo: 'texto',
        soloHistoriaClinica: true,
      },
      {
        key: 'pod_circunstancia',
        label: 'Circunstancia desencadenante o que lo modifica',
        tipo: 'texto',
        soloHistoriaClinica: true,
      },
      {
        key: 'pod_tipo_dolor',
        label: 'Tipo de dolor',
        tipo: 'texto',
        ayuda: 'Punzante, ardoroso, opresivo… El dolor cambia entre consultas.',
      },
      {
        key: 'pod_frecuencia_dolor',
        label: 'Frecuencia del dolor',
        tipo: 'seleccion',
        opciones: ['Diurno', 'Nocturno', 'Intermitente'],
      },

      // ── Antecedentes familiares (hoja 1). Sobre la FAMILIA del paciente,
      // no sobre él: la hoja de papel repite la misma batería de hábitos bajo
      // los dos encabezados —familiares y personales— y aquí se respeta esa
      // misma duplicación, con prefijo `fam_` para no confundir las llaves.
      {
        key: 'pod_fam_fuma',
        label: 'Familiares: fuma',
        tipo: 'seleccion',
        opciones: ['No', 'Sí'],
        soloHistoriaClinica: true,
      },
      {
        key: 'pod_fam_alcohol',
        label: 'Familiares: consume bebidas alcohólicas',
        tipo: 'seleccion',
        opciones: ['No', 'Sí'],
        soloHistoriaClinica: true,
      },
      {
        key: 'pod_fam_medicamentos_drogas',
        label: 'Familiares: medicamentos y/o drogas',
        tipo: 'seleccion',
        opciones: ['No', 'Sí'],
        soloHistoriaClinica: true,
      },
      {
        key: 'pod_fam_actividad_fisica',
        label: 'Familiares: realiza actividad física',
        tipo: 'seleccion',
        opciones: ['No', 'Sí'],
        soloHistoriaClinica: true,
      },
      {
        key: 'pod_fam_actividad_fisica_detalle',
        label: 'Familiares: cuál y con qué frecuencia',
        tipo: 'texto',
        soloHistoriaClinica: true,
      },
      {
        key: 'pod_fam_comparte_calzado',
        label: 'Familiares: comparte calzado',
        tipo: 'seleccion',
        opciones: ['No', 'Sí'],
        soloHistoriaClinica: true,
      },
      {
        key: 'pod_fam_descalzo_publico',
        label: 'Familiares: frecuenta lugares públicos descalzo',
        tipo: 'seleccion',
        opciones: ['No', 'Sí'],
        soloHistoriaClinica: true,
      },

      // ── Antecedentes personales no patológicos (hoja 1). Los hábitos del
      // paciente mismo. `pod_comparte_calzado` y `pod_descalzo_publico` no
      // llevan prefijo: son las versiones "personales" de esas dos preguntas,
      // las que de verdad condicionan el riesgo podológico del propio pie.
      {
        key: 'pod_fuma',
        label: 'Fuma',
        tipo: 'seleccion',
        opciones: ['No', 'Sí'],
        soloHistoriaClinica: true,
      },
      {
        key: 'pod_alcohol',
        label: 'Consume bebidas alcohólicas',
        tipo: 'seleccion',
        opciones: ['No', 'Sí'],
        soloHistoriaClinica: true,
      },
      {
        key: 'pod_medicamentos_drogas',
        label: 'Medicamentos y/o drogas',
        tipo: 'seleccion',
        opciones: ['No', 'Sí'],
        soloHistoriaClinica: true,
      },
      {
        key: 'pod_actividad_fisica',
        label: 'Realiza actividad física',
        tipo: 'seleccion',
        opciones: ['No', 'Sí'],
        soloHistoriaClinica: true,
      },
      {
        key: 'pod_actividad_fisica_detalle',
        label: 'Cuál y con qué frecuencia',
        tipo: 'texto',
        soloHistoriaClinica: true,
      },
      {
        key: 'pod_comparte_calzado',
        label: 'Comparte calzado',
        tipo: 'seleccion',
        opciones: ['No', 'Sí'],
        soloHistoriaClinica: true,
      },
      {
        key: 'pod_descalzo_publico',
        label: 'Anda descalzo en lugares públicos',
        tipo: 'seleccion',
        opciones: ['No', 'Sí'],
        soloHistoriaClinica: true,
        ayuda: 'Vía de contagio habitual de micosis y verruga plantar.',
      },

      // ── Antecedentes personales patológicos (hoja 1): el checklist de la
      // esquina inferior. Una casilla marcada aquí es un antecedente que el
      // pie carga toda la vida (diabetes, VIH, cáncer…), así que se pregunta
      // UNA vez en la historia clínica — no en cada nota de control.
      //
      // Se solapa a propósito con BANDERAS_CLINICAS (que ya tiene 'diabetes' y
      // 'embarazo'): son cosas DISTINTAS y no un descuido. BANDERAS_CLINICAS
      // vive en el PACIENTE, dispara el banner de alerta al abrir cualquier
      // consulta y trae una `conducta` clínica accionable. Esto vive en la
      // NOTA, es la transcripción fiel del checklist de papel de esta
      // especialidad, y no dispara ninguna alerta por sí solo. Si algún día se
      // decide que 'Diabetes mellitus' aquí debería encender la bandera del
      // paciente automáticamente, ese es un cambio de comportamiento nuevo —
      // no una limpieza de "duplicado".
      {
        key: 'pod_antecedentes_patologicos',
        label: 'Antecedentes personales patológicos',
        tipo: 'multi-seleccion',
        soloHistoriaClinica: true,
        opciones: [
          'Cirugías ortopédicas',
          'Circulación',
          'Cardiopatías',
          'Embarazo',
          'Alergias',
          'Diabetes mellitus',
          'Presión arterial',
          'Enfermedad renal',
          'Lactando',
          'Artritis',
          'Hipoglucemiantes',
          'Traumatismo',
          'V.I.H.',
          'Aspirina',
          'Gota',
          'Enfermedades dermatológicas',
          'Inmunológicas',
          'Cáncer',
          'Varices',
          'Analgésico',
        ],
      },
      {
        key: 'pod_antecedentes_patologicos_otras',
        label: 'Otras',
        tipo: 'texto',
        soloHistoriaClinica: true,
      },

      {
        key: 'pod_numero_calzado',
        label: 'Número de calzado',
        tipo: 'texto',
        ayuda: 'Un calzado mal medido es causa de lesión por sí solo.',
      },
      {
        key: 'pod_tipo_pie',
        label: 'Tipo de pie (fórmula digital)',
        tipo: 'seleccion',
        opciones: ['Egipcio', 'Griego', 'Polinesio (cuadrado)'],
        soloHistoriaClinica: true,
      },
      {
        key: 'pod_huella_plantar',
        label: 'Huella plantar',
        tipo: 'seleccion',
        opciones: [
          'Normal',
          'Pie plano',
          'Pie plano valgo',
          'Pie plano valgo pronado grave',
          'Pie cavo',
          'Pie cavo en garra',
          'Pie calcáneo elevado',
        ],
      },
      // ── Exploración manual e instrumentada (hoja 2) ──
      //
      // Todo va por pie y en pares izq/der consecutivos: la rejilla los pinta
      // a dos columnas, así que el par queda lado a lado y se lee como la
      // tabla del papel. El orden de este arreglo ES el de la pantalla.
      {
        key: 'pod_estructura_osea_izq',
        label: 'Estructura ósea · izquierdo',
        tipo: 'seleccion',
        opciones: ['Normal', 'Anormal'],
      },
      {
        key: 'pod_estructura_osea_der',
        label: 'Estructura ósea · derecho',
        tipo: 'seleccion',
        opciones: ['Normal', 'Anormal'],
      },
      {
        key: 'pod_temperatura_izq',
        label: 'Temperatura · izquierdo',
        tipo: 'seleccion',
        opciones: ['Normal', 'Aumentada', 'Disminuida'],
      },
      {
        key: 'pod_temperatura_der',
        label: 'Temperatura · derecho',
        tipo: 'seleccion',
        opciones: ['Normal', 'Aumentada', 'Disminuida'],
      },
      {
        key: 'pod_llenado_capilar_izq',
        label: 'Llenado capilar · izquierdo',
        tipo: 'seleccion',
        opciones: ['Normal (< 3 s)', 'Retardado (> 3 s)'],
      },
      {
        key: 'pod_llenado_capilar_der',
        label: 'Llenado capilar · derecho',
        tipo: 'seleccion',
        opciones: ['Normal (< 3 s)', 'Retardado (> 3 s)'],
      },

      // ── Cribado de pie diabético. Por pie: la asimetría ES el hallazgo. ──
      {
        key: 'pod_monofilamento_izq',
        label: 'Monofilamento · pie izquierdo',
        tipo: 'seleccion',
        opciones: ['Normal', 'Disminuida', 'Ausente', 'No valorada'],
        ayuda: 'Semmes-Weinstein 10 g. La sensibilidad ausente es pie de riesgo.',
      },
      {
        key: 'pod_monofilamento_der',
        label: 'Monofilamento · pie derecho',
        tipo: 'seleccion',
        opciones: ['Normal', 'Disminuida', 'Ausente', 'No valorada'],
      },
      {
        key: 'pod_pulso_pedio_izq',
        label: 'Pulso pedio · izquierdo',
        tipo: 'seleccion',
        opciones: ['Presente', 'Disminuido', 'Ausente'],
      },
      {
        key: 'pod_pulso_pedio_der',
        label: 'Pulso pedio · derecho',
        tipo: 'seleccion',
        opciones: ['Presente', 'Disminuido', 'Ausente'],
      },
      {
        key: 'pod_pulso_tibial_izq',
        label: 'Pulso tibial posterior · izquierdo',
        tipo: 'seleccion',
        opciones: ['Presente', 'Disminuido', 'Ausente'],
      },
      {
        key: 'pod_pulso_tibial_der',
        label: 'Pulso tibial posterior · derecho',
        tipo: 'seleccion',
        opciones: ['Presente', 'Disminuido', 'Ausente'],
      },
      {
        key: 'pod_reflejo_rotuliano_izq',
        label: 'Reflejo rotuliano · izquierdo',
        tipo: 'seleccion',
        opciones: ['Normal', 'Disminuido', 'Ausente'],
      },
      {
        key: 'pod_reflejo_rotuliano_der',
        label: 'Reflejo rotuliano · derecho',
        tipo: 'seleccion',
        opciones: ['Normal', 'Disminuido', 'Ausente'],
      },
      {
        key: 'pod_reflejo_aquileo_izq',
        label: 'Reflejo aquíleo · izquierdo',
        tipo: 'seleccion',
        opciones: ['Normal', 'Disminuido', 'Ausente'],
      },
      {
        key: 'pod_reflejo_aquileo_der',
        label: 'Reflejo aquíleo · derecho',
        tipo: 'seleccion',
        opciones: ['Normal', 'Disminuido', 'Ausente'],
      },
      {
        key: 'pod_diapason_izq',
        label: 'Diapasón · izquierdo',
        tipo: 'seleccion',
        opciones: ['Normal', 'Disminuida', 'Ausente'],
        ayuda: 'Sensibilidad vibratoria, 128 Hz.',
      },
      {
        key: 'pod_diapason_der',
        label: 'Diapasón · derecho',
        tipo: 'seleccion',
        opciones: ['Normal', 'Disminuida', 'Ausente'],
      },
      {
        key: 'pod_riesgo_pie_diabetico',
        label: 'Riesgo de pie diabético',
        tipo: 'seleccion',
        opciones: ['No aplica', 'Bajo', 'Moderado', 'Alto'],
        obligatorio: true,
        ayuda:
          'Obligatorio: es la conclusión del cribado y la que fija cada cuándo debe volver el paciente.',
      },
      {
        key: 'pod_calzado_habitual',
        label: 'Tipo de calzado habitual',
        tipo: 'texto',
        ayuda: 'Puntera estrecha, tacón, calzado deportivo, de seguridad…',
      },
      {
        key: 'pod_exploracion_visual',
        label: 'Notas de la exploración visual',
        tipo: 'texto-rico',
        ayuda:
          'Lo que el mapa podológico no alcanza a expresar: evolución de una lesión, medidas, coloración, olor.',
      },
    ],
  },
};

/** True si `value` es una clave de especialidad conocida. */
export function esEspecialidadValida(value: unknown): value is EspecialidadKey {
  return typeof value === 'string' && (ESPECIALIDADES as readonly string[]).includes(value);
}

/**
 * Perfil de una especialidad, con caída SEGURA a 'general'.
 *
 * Nunca lanza. Es intencional: este helper corre en el camino de cerrar una
 * nota clínica, y una clave desconocida (una nota vieja, una especialidad que
 * se retiró del catálogo) jamás debe impedir que un médico firme su nota.
 * Ante la duda, se aplica la base NOM-004 y ya.
 */
export function perfilDe(key: string | null | undefined): PerfilEspecialidad {
  return esEspecialidadValida(key) ? PERFILES[key] : PERFILES.general;
}

/** Opciones para poblar un `<select>`, con 'general' siempre primero. */
export function opcionesEspecialidad(): { key: EspecialidadKey; nombre: string }[] {
  return ESPECIALIDADES.map((key) => ({ key, nombre: PERFILES[key].nombre }));
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * Orden de plantillas ortopédicas (laboratorio "Microrthopedic Solutions").
 *
 * Es la hoja de pedido que el podólogo llena para mandar fabricar la órtesis
 * de un paciente. Se digitaliza tal cual el formato del laboratorio —incluidos
 * sus nombres en inglés— porque es lo que se le envía sin traducir.
 *
 * VIVE FUERA de la nota clínica a propósito (ver docs/adr/0001). Una nota
 * firmada es inmutable por NOM-004; esta orden no lo es: el laboratorio puede
 * pedir corregir una medida días después de que la consulta ya se cerró, y una
 * nota firmada no puede reabrirse para eso. Es un documento hermano de
 * `presupuestos`/`radiografias` — cuelga del paciente y de la cita que lo
 * originó, con su propio ciclo de vida.
 *
 * El catálogo de casillas se modela como DATOS, con el mismo criterio que
 * `PERFILES`/`ESTADOS_DENTALES`/`HALLAZGOS_PODOLOGICOS`: si el laboratorio
 * cambia su formato, se edita esta lista y no hay nada que migrar.
 * ═══════════════════════════════════════════════════════════════════
 */

export const GRUPOS_PLANTILLA = [
  'corrective_line',
  'sport_line',
  'formal_wear_line',
  'accommodative_line',
  'casting_modifications',
  'positing_instructions',
  'forefoot_posting',
  'shell_modification',
  'covering_extension_material',
  'covering_top_material',
  'top_cover_materials',
  'accommodations',
  'arch_reinforcement_material',
  'examination_hallux_dorsiflexion',
  'examination_first_ray_position',
  'examination_arch_appearance',
  'examination_subtalar_joint',
  'examination_rested_calcaneal',
] as const;
export type GrupoPlantilla = (typeof GRUPOS_PLANTILLA)[number];

/** Encabezados de sección, en el orden en que aparecen en la hoja del laboratorio. */
export const ETIQUETA_GRUPO_PLANTILLA: Record<GrupoPlantilla, string> = {
  corrective_line: 'Corrective Line',
  sport_line: 'Sport Line',
  formal_wear_line: 'Formal Wear Line',
  accommodative_line: 'Accommodative Line',
  casting_modifications: 'Casting Modifications',
  positing_instructions: 'Positing Instructions',
  forefoot_posting: 'Forefoot Posting',
  shell_modification: 'Shell Modification',
  covering_extension_material: 'Covering · Extension Material (PPT/Plastazote/EVA)',
  covering_top_material: 'Covering · Top Cover Material (PPT/Plastazote/EVA)',
  top_cover_materials: 'Top Cover Materials',
  accommodations: 'Accommodations',
  arch_reinforcement_material: 'Arch Reinforcement',
  examination_hallux_dorsiflexion: 'Examination Findings · Hallux Dorsiflexion',
  examination_first_ray_position: 'Examination Findings · 1st Ray Position',
  examination_arch_appearance: 'Examination Findings · Arch Appearance (Weight Bearing)',
  examination_subtalar_joint: 'Examination Findings · Subtalar Joint',
  examination_rested_calcaneal: 'Examination Findings · Rested Calcaneal Forefoot',
};

export interface OpcionPlantilla {
  key: string;
  label: string;
  grupo: GrupoPlantilla;
  /**
   * true = la casilla se marca por separado para cada pie (columnas R/L de la
   * hoja de papel). false = una sola casilla, aplica a la orden completa.
   */
  porLado: boolean;
}

export const OPCIONES_PLANTILLA: readonly OpcionPlantilla[] = [
  // ── Corrective Line ──
  { key: 'micro_heel_pain', label: 'Micro Heel Pain', grupo: 'corrective_line', porLado: false },
  { key: 'micro_ucbl', label: 'Micro UCBL', grupo: 'corrective_line', porLado: false },
  { key: 'micro_gait_plate', label: 'Micro Gait Plate (in toeing, out toeing)', grupo: 'corrective_line', porLado: false },
  { key: 'micro_unit', label: 'Micro Unit', grupo: 'corrective_line', porLado: false },
  { key: 'micro_biomechanical', label: 'Micro Biomechanical', grupo: 'corrective_line', porLado: false },
  { key: 'micro_cork_leather', label: 'Micro Cork and Leather', grupo: 'corrective_line', porLado: false },

  // ── Sport Line ──
  { key: 'micro_carbo_sport', label: 'Micro Carbo Sport', grupo: 'sport_line', porLado: false },
  { key: 'micro_sport', label: 'Micro Sport', grupo: 'sport_line', porLado: false },
  { key: 'micro_all_sport', label: 'Micro All Sport', grupo: 'sport_line', porLado: false },
  { key: 'micro_sumbarobic', label: 'Micro Sumbarobic', grupo: 'sport_line', porLado: false },
  { key: 'micro_basketball', label: 'Micro Basketball', grupo: 'sport_line', porLado: false },
  { key: 'micro_tennis', label: 'Micro Tennis', grupo: 'sport_line', porLado: false },
  { key: 'micro_soccer', label: 'Micro Soccer', grupo: 'sport_line', porLado: false },
  { key: 'micro_runners', label: 'Micro Runners', grupo: 'sport_line', porLado: false },
  { key: 'micro_football', label: 'Micro Foot Ball', grupo: 'sport_line', porLado: false },
  { key: 'micro_ski', label: 'Micro Ski', grupo: 'sport_line', porLado: false },
  { key: 'micro_golf', label: 'Micro Golf', grupo: 'sport_line', porLado: false },
  { key: 'micro_marathoner', label: 'Micro Marathoner', grupo: 'sport_line', porLado: false },

  // ── Formal Wear Line ──
  { key: 'micro_fashion', label: 'Micro Fashion', grupo: 'formal_wear_line', porLado: false },
  { key: 'micro_dress', label: 'Micro Dress', grupo: 'formal_wear_line', porLado: false },
  { key: 'micro_carbo_dress', label: 'Micro Carbo Dress', grupo: 'formal_wear_line', porLado: false },
  { key: 'micro_cobra_wing', label: 'Micro Cobra or Wing', grupo: 'formal_wear_line', porLado: false },
  { key: 'micro_lite', label: 'Micro Lite', grupo: 'formal_wear_line', porLado: false },
  { key: 'micro_high_heel_fit', label: 'Micro High Heel Fit', grupo: 'formal_wear_line', porLado: false },

  // ── Accommodative Line ──
  { key: 'micro_accommodative', label: 'Micro Accommodative', grupo: 'accommodative_line', porLado: false },
  { key: 'micro_light_blue_diabetic', label: 'Micro Light Blue Diabetic', grupo: 'accommodative_line', porLado: false },
  { key: 'micro_semi_rigid_diabetic', label: 'Micro Semi Rigid Diabetic', grupo: 'accommodative_line', porLado: false },
  { key: 'micro_rigid_diabetic', label: 'Micro Rigid Diabetic', grupo: 'accommodative_line', porLado: false },
  { key: 'fit_to_shoe', label: 'Fit to Shoe', grupo: 'accommodative_line', porLado: false },
  { key: 'shoe_enclosed', label: 'Shoe Enclosed', grupo: 'accommodative_line', porLado: false },
  { key: 'positive_cast_enclosed', label: 'Positive Cast Enclosed', grupo: 'accommodative_line', porLado: false },
  { key: 'orthotics_enclosed', label: 'Orthotics Enclosed', grupo: 'accommodative_line', porLado: false },

  // ── Casting Modifications ──
  { key: 'do_not_lower_la', label: 'Do Not Lower LA', grupo: 'casting_modifications', porLado: false },
  { key: 'raise_la', label: 'Raise LA', grupo: 'casting_modifications', porLado: false },
  { key: 'medial_arch_platform', label: 'Medial Arch Platform', grupo: 'casting_modifications', porLado: false },
  { key: 'medial_heel_skive', label: 'Medial Heel Skive', grupo: 'casting_modifications', porLado: false },
  { key: 'pf_groove', label: 'PF Groove', grupo: 'casting_modifications', porLado: false },
  { key: 'button_out_area_casting', label: 'Button Out Area', grupo: 'casting_modifications', porLado: false },

  // ── Positing Instructions (rearfoot post) ──
  { key: 'neutral_shell', label: 'Neutral Shell', grupo: 'positing_instructions', porLado: false },

  // ── Forefoot Posting ──
  { key: 'ff_post_to_sulcus', label: 'FF Post To Sulcus', grupo: 'forefoot_posting', porLado: false },
  { key: 'tip_post', label: 'Tip Post', grupo: 'forefoot_posting', porLado: true },
  { key: 'bar_1_5', label: '1-5 Bar', grupo: 'forefoot_posting', porLado: true },
  { key: 'bar_2_5', label: '2-5 Bar', grupo: 'forefoot_posting', porLado: true },

  // ── Shell Modification ──
  { key: 'deep_heel_seat', label: 'Deep Heel Seat', grupo: 'shell_modification', porLado: true },
  { key: 'shallow_heel_seat', label: 'Shallow Heel Seat', grupo: 'shell_modification', porLado: true },
  { key: 'widen_orthotics', label: 'Widen Orthotics', grupo: 'shell_modification', porLado: true },
  { key: 'narrow_orthotics', label: 'Narrow Orthotics', grupo: 'shell_modification', porLado: true },
  { key: 'medial_flange', label: 'Medial Flange', grupo: 'shell_modification', porLado: true },
  { key: 'lateral_flange', label: 'Lateral Flange', grupo: 'shell_modification', porLado: true },
  { key: 'first_ray_cut_out', label: '1st Ray Cut Out', grupo: 'shell_modification', porLado: true },
  { key: 'fifth_ray_cut_out', label: '5th Ray Cut Out', grupo: 'shell_modification', porLado: true },
  { key: 'heel_punch_out', label: 'Heel Punch Out', grupo: 'shell_modification', porLado: true },
  { key: 'rigid_mortons_ext', label: "Rigid Morton's Ext", grupo: 'shell_modification', porLado: true },
  { key: 'button_out_area_shell', label: 'Button Out Area', grupo: 'shell_modification', porLado: true },

  // ── Covering: materiales de la extensión y del top cover ──
  { key: 'covering_ext_ppt', label: 'PPT', grupo: 'covering_extension_material', porLado: false },
  { key: 'covering_ext_plastazote', label: 'Plastazote', grupo: 'covering_extension_material', porLado: false },
  { key: 'covering_ext_eva', label: 'EVA', grupo: 'covering_extension_material', porLado: false },
  { key: 'covering_top_ppt', label: 'PPT', grupo: 'covering_top_material', porLado: false },
  { key: 'covering_top_plastazote', label: 'Plastazote', grupo: 'covering_top_material', porLado: false },
  { key: 'covering_top_eva', label: 'EVA', grupo: 'covering_top_material', porLado: false },

  // ── Top Cover Materials (columna derecha de la hoja) ──
  { key: 'suede', label: 'Suede', grupo: 'top_cover_materials', porLado: false },
  { key: 'glove_leather', label: 'Glove Leather', grupo: 'top_cover_materials', porLado: false },
  { key: 'black_leather', label: 'Black Leather', grupo: 'top_cover_materials', porLado: false },
  { key: 'ppt_plastazote', label: 'PPT/Plastazote', grupo: 'top_cover_materials', porLado: false },
  { key: 'black_spenco', label: 'Black Spenco', grupo: 'top_cover_materials', porLado: false },
  { key: 'black_eva', label: 'Black Eva', grupo: 'top_cover_materials', porLado: false },
  { key: 'ucolite', label: 'Ucolite', grupo: 'top_cover_materials', porLado: false },
  { key: 'multicolor_eva', label: 'Multicolor Eva', grupo: 'top_cover_materials', porLado: false },
  { key: 'black_gray_swirl', label: 'Black/Gray Swirl', grupo: 'top_cover_materials', porLado: false },

  // ── Accommodations ──
  { key: 'heel_spur_pad', label: 'Heel Spur Pad', grupo: 'accommodations', porLado: true },
  { key: 'heel_cushion', label: 'Heel Cushion', grupo: 'accommodations', porLado: true },
  { key: 'met_pad', label: 'Met Pad', grupo: 'accommodations', porLado: true },
  { key: 'met_bar', label: 'Met Bar', grupo: 'accommodations', porLado: true },
  { key: 'dancers_pad', label: 'Dancers Pad', grupo: 'accommodations', porLado: true },
  { key: 'reverse_mortons', label: "Reverse Morton's", grupo: 'accommodations', porLado: true },
  { key: 'scaphoid_pad', label: 'Scaphoid Pad', grupo: 'accommodations', porLado: true },
  { key: 'neuroma_pad', label: 'Neuroma Pad', grupo: 'accommodations', porLado: true },
  { key: 'neuroma_plug', label: 'Neuroma Plug', grupo: 'accommodations', porLado: true },
  { key: 'mortons_ext', label: "Morton's Ext", grupo: 'accommodations', porLado: true },
  { key: 'cuboid_pad', label: 'Cuboid Pad', grupo: 'accommodations', porLado: true },
  { key: 'navicular_flap', label: 'Navicular Flap', grupo: 'accommodations', porLado: true },
  { key: 'toe_filler', label: 'Toe Filler', grupo: 'accommodations', porLado: true },

  // ── Arch Reinforcement (materiales, sin lado) ──
  { key: 'arch_ppt', label: 'PPT', grupo: 'arch_reinforcement_material', porLado: false },
  { key: 'arch_eva', label: 'EVA', grupo: 'arch_reinforcement_material', porLado: false },
  { key: 'arch_cork', label: 'Cork', grupo: 'arch_reinforcement_material', porLado: false },

  // ── Examination Findings ──
  { key: 'hallux_rigid', label: 'Rigid', grupo: 'examination_hallux_dorsiflexion', porLado: true },
  { key: 'hallux_semi_rigid', label: 'Semi-Rigid', grupo: 'examination_hallux_dorsiflexion', porLado: true },
  { key: 'hallux_normal', label: 'Normal', grupo: 'examination_hallux_dorsiflexion', porLado: true },

  { key: 'first_ray_plantarflexed', label: 'Plantarflexed', grupo: 'examination_first_ray_position', porLado: true },
  { key: 'first_ray_dorsiflexed', label: 'Dorsiflexed', grupo: 'examination_first_ray_position', porLado: true },
  { key: 'first_ray_normal', label: 'Normal', grupo: 'examination_first_ray_position', porLado: true },

  { key: 'arch_high', label: 'High Arch', grupo: 'examination_arch_appearance', porLado: true },
  { key: 'arch_medium', label: 'Medium Arch', grupo: 'examination_arch_appearance', porLado: true },
  { key: 'arch_low', label: 'Low Arch', grupo: 'examination_arch_appearance', porLado: true },

  { key: 'subtalar_inversion', label: 'Inversion', grupo: 'examination_subtalar_joint', porLado: true },
  { key: 'subtalar_eversion', label: 'Eversion', grupo: 'examination_subtalar_joint', porLado: true },
  { key: 'subtalar_neutral', label: 'Neutral', grupo: 'examination_subtalar_joint', porLado: true },

  { key: 'calcaneal_varus', label: 'Varus', grupo: 'examination_rested_calcaneal', porLado: true },
  { key: 'calcaneal_valgus', label: 'Valgus', grupo: 'examination_rested_calcaneal', porLado: true },
] as const;

export function opcionPlantillaPorKey(key: string): OpcionPlantilla | undefined {
  return OPCIONES_PLANTILLA.find((o) => o.key === key);
}

export function opcionesPlantillaDeGrupo(grupo: GrupoPlantilla): OpcionPlantilla[] {
  return OPCIONES_PLANTILLA.filter((o) => o.grupo === grupo);
}

/** Marca de una casilla `porLado: true`, para un pie específico. */
export interface MarcaPlantilla {
  /** Clave de OPCIONES_PLANTILLA. */
  opcion: string;
  lado: LadoPie;
}

/**
 * Campos de valor libre (grados de posting, espesores, hasta dónde llega la
 * cobertura…) que en la hoja de papel son una línea en blanco, no una casilla.
 * Mismo criterio que `CampoExtra`: se declaran como datos para que agregar o
 * quitar uno sea editar esta lista.
 */
export interface ValorPlantilla {
  key: string;
  label: string;
  tipo: 'texto' | 'seleccion';
  opciones?: readonly string[];
}

export const VALORES_PLANTILLA: readonly ValorPlantilla[] = [
  { key: 'rearfoot_post_tipo', label: 'Rearfoot post', tipo: 'seleccion', opciones: ['Intrinsic', 'Extrinsic'] },
  { key: 'rearfoot_varus_derecho', label: 'Rearfoot varus · derecho', tipo: 'texto' },
  { key: 'rearfoot_valgus_derecho', label: 'Rearfoot valgus · derecho', tipo: 'texto' },
  { key: 'rearfoot_varus_izquierdo', label: 'Rearfoot varus · izquierdo', tipo: 'texto' },
  { key: 'rearfoot_valgus_izquierdo', label: 'Rearfoot valgus · izquierdo', tipo: 'texto' },
  { key: 'forefoot_post_tipo', label: 'Forefoot post', tipo: 'seleccion', opciones: ['Intrinsic', 'Extrinsic'] },
  { key: 'forefoot_varus_derecho', label: 'Forefoot varus · derecho', tipo: 'texto' },
  { key: 'forefoot_valgus_derecho', label: 'Forefoot valgus · derecho', tipo: 'texto' },
  { key: 'forefoot_varus_izquierdo', label: 'Forefoot varus · izquierdo', tipo: 'texto' },
  { key: 'forefoot_valgus_izquierdo', label: 'Forefoot valgus · izquierdo', tipo: 'texto' },
  { key: 'covering_ext_hasta', label: 'Covering · extension: hasta', tipo: 'seleccion', opciones: ['Sulcus', 'Toes'] },
  { key: 'covering_ext_grosor', label: 'Covering · extension: espesor', tipo: 'seleccion', opciones: ['1/16', '1/8', '3/16'] },
  { key: 'covering_top_hasta', label: 'Covering · top cover: hasta', tipo: 'seleccion', opciones: ['Mets', 'Sulcus', 'Toes'] },
  { key: 'covering_top_grosor', label: 'Covering · top cover: espesor', tipo: 'seleccion', opciones: ['1/16', '1/8', '3/16'] },
  { key: 'covering_bottom', label: 'Bottom cover', tipo: 'seleccion', opciones: ['Suede', 'Vinyl'] },
  { key: 'top_cover_vinyl_color', label: 'Vinyl color', tipo: 'seleccion', opciones: ['Black', 'White'] },
  { key: 'tibial_varum_derecho', label: 'Tibial varum · derecho', tipo: 'texto' },
  { key: 'tibial_varum_izquierdo', label: 'Tibial varum · izquierdo', tipo: 'texto' },
] as const;

export function valorPlantillaPorKey(key: string): ValorPlantilla | undefined {
  return VALORES_PLANTILLA.find((v) => v.key === key);
}

/**
 * 'completada' y no 'enviada' a propósito: HealthFlow no manda nada al
 * laboratorio por su cuenta (no hay integración real con Microrthopedic
 * Solutions). La marca solo dice que el médico terminó de llenarla — enviarla
 * de verdad sigue siendo imprimirla y entregarla/faxearla fuera del sistema.
 */
export type EstatusOrdenPlantillas = 'borrador' | 'completada' | 'cancelada';

/** Contenido editable de la orden (todo lo que no es metadata de auditoría). */
export interface OrdenPlantillasContent {
  practitionerName?: string;
  accountNumber?: string;
  shoeSize?: string;
  shoeType?: string;
  weight?: string;
  diagnosis?: string;
  /** ISO date. */
  dateRequired?: string;
  returnCastToDr?: boolean;
  mailToPatient?: boolean;

  /** Claves de OPCIONES_PLANTILLA con `porLado: false` que están marcadas. */
  opciones: string[];
  /** Casillas `porLado: true`, una entrada por pie marcado. */
  marcas: MarcaPlantilla[];
  /** Claves de VALORES_PLANTILLA con su valor capturado. */
  valores: Record<string, string>;

  /**
   * Mapa de pies de ESTA orden — mismo componente e igual catálogo de
   * hallazgos/zonas que el podograma de la nota clínica (`ZONAS_PIE` /
   * `HALLAZGOS_PODOLOGICOS`), pero con sus PROPIAS marcas. No se comparte el
   * arreglo con la nota a propósito: la orden es un documento independiente,
   * con su propio ciclo de vida (se puede seguir editando después de que la
   * nota ya se firmó), y mutar en silencio el podograma clínico desde aquí
   * sería tocar un expediente cerrado por la puerta de atrás.
   */
  podograma: Podograma;

  specialInstructions?: string;
}

export const ORDEN_PLANTILLAS_VACIA: OrdenPlantillasContent = {
  opciones: [],
  marcas: [],
  valores: {},
  podograma: PODOGRAMA_VACIO,
};

/** Vista de la orden tal como la consume la UI. Fechas en ISO. */
export interface OrdenPlantillasView {
  id: string;
  patientId: string;
  appointmentId: string | null;
  doctorId: string;
  estatus: EstatusOrdenPlantillas;
  contenido: OrdenPlantillasContent;
  createdAt: string;
  updatedAt: string;
}

/**
 * `OrdenPlantillasView` + los nombres para imprimir. Se separan del `View`
 * base porque el modal de la consulta (que ya sabe quién es el paciente y el
 * médico por el contexto de la pantalla) no necesita pagar el JOIN extra en
 * cada autosave — solo lo pide la vista de impresión y el listado del
 * expediente, que si parten de cero.
 */
export interface OrdenPlantillasDetalle extends OrdenPlantillasView {
  patientNombre: string;
  /** Datos que el formato del laboratorio pide del paciente, no de la orden. */
  patientTelefono: string | null;
  patientSexo: SexoPaciente | null;
  patientEdad: number;
  doctorNombre: string;
  doctorCedula: string | null;
  doctorCedulaEspecialidad: string | null;
  nombreClinica: string;
  direccionClinica: string | null;
  telefonoClinica: string | null;
}

// ── Receta médica ────────────────────────────────────────────────
// Marco: Ley General de Salud art. 226 (fracciones de medicamentos) y
// Reglamento de Insumos para la Salud arts. 28, 29, 64 y 65 (datos que debe
// llevar la receta). La receta es un documento HERMANO de la nota, no parte de
// ella: una nota cerrada es inmutable por NOM-004, pero una receta puede
// necesitar reemitirse después de que la consulta terminó — mismo criterio
// que `ordenes_plantillas`.

/**
 * Fracciones del art. 226 LGS que exigen recetario especial con código de
 * barras expedido por COFEPRIS a nombre del médico. HealthFlow no imprime ese
 * formato, así que no puede emitirlas: ver `MedicamentoControladoNoEmisible`.
 */
export const FRACCIONES_NO_EMISIBLES = [1, 2] as const;

export function esFraccionEmisible(fraccion: number | null): boolean {
  return fraccion === null || !(FRACCIONES_NO_EMISIBLES as readonly number[]).includes(fraccion);
}

/** Cómo se surte cada fracción, para explicárselo al médico en la UI. */
export const ETIQUETAS_FRACCION: Record<number, string> = {
  1: 'Estupefaciente — requiere recetario especial de COFEPRIS',
  2: 'Psicotrópico grupo II — requiere recetario especial de COFEPRIS',
  3: 'Psicotrópico grupo III — la receta se retiene, hasta 2 resurtidos',
  4: 'La receta se retiene en la farmacia',
  5: 'Requiere receta; no se retiene',
  6: 'Libre venta',
};

/** Una fila del catálogo de medicamentos (tabla global `medicamentos`). */
export interface MedicamentoCatalogo {
  clave: string;
  denominacionGenerica: string;
  formaFarmaceutica: string;
  presentacion: string;
  viaSugerida: string;
  grupoTerapeutico: string;
  /** Fracción del art. 226 LGS. Ver FRACCIONES_NO_EMISIBLES. */
  fraccion: number;
}

export const VIAS_ADMINISTRACION = [
  'Oral',
  'Sublingual',
  'Bucal',
  'Tópica',
  'Transdérmica',
  'Oftálmica',
  'Ótica',
  'Nasal',
  'Rectal',
  'Vaginal',
  'Inhalada',
  'Intramuscular',
  'Intravenosa',
  'Subcutánea',
  'Infiltración',
] as const;
export type ViaAdministracion = (typeof VIAS_ADMINISTRACION)[number];

/**
 * Datos del emisor congelados al momento de emitir (RIS art. 64 y 65).
 *
 * Tipo PROPIO y no una extensión de `FirmaMedica`: aquélla ya está persistida
 * con exactamente tres campos dentro del jsonb de cada nota cerrada, y una
 * nota cerrada es inmutable, así que agregarle campos obligatorios volvería
 * ilegibles los expedientes históricos. Son además dos cosas distintas:
 * `FirmaMedica` dice QUIÉN cerró una nota; esto es el membrete legal de un
 * documento que sale del consultorio en manos del paciente.
 */
export interface EmisorReceta {
  medicoNombre: string;
  /**
   * OPCIONAL a propósito: este tipo describe un snapshot ya persistido en el
   * jsonb de cada receta emitida, y las anteriores a este campo no lo traen.
   * Volverlo obligatorio haría ilegibles las recetas históricas — mismo
   * criterio que se aplicó al no extender `FirmaMedica`.
   */
  titulo?: TituloMedico | null;
  /**
   * Apariencia con la que se imprimió ESTA receta. Opcional por lo mismo que
   * `titulo`: las emitidas antes de existir el campo no la traen y se leen
   * con CONFIG_RECETA_DEFAULT. Se congela al emitir a propósito — si el
   * médico cambia su diseño en marzo, la receta de enero debe reimprimirse
   * como se firmó, no como se ve hoy.
   */
  config?: ConfigReceta | null;
  cedulaProfesional: string;
  /** Null si el médico no tiene especialidad certificada: el art. 65 solo la pide a especialistas. */
  cedulaEspecialidad: string | null;
  especialidad: string | null;
  /** RIS art. 64: institución que expidió el título. */
  institucionTitulo: string;
  nombreClinica: string;
  /** RIS art. 64: domicilio del establecimiento. */
  domicilioEstablecimiento: string;
  telefonoClinica: string | null;
  /**
   * Clave estable en storage (no URL): la firmada expira en minutos, pero
   * este snapshot se conserva para siempre. `GetRecetaDetalleUseCase` la
   * resuelve a `logoUrl` en cada lectura. null = la clínica no tenía logo al
   * emitir esta receta.
   */
  logoStorageKey: string | null;
  /** Solo se llena al LEER (nunca se guarda en el snapshot). */
  logoUrl?: string;
  /** Texto libre para el pie de la receta impresa. null = sin leyenda. */
  leyendaPie: string | null;
}

/**
 * RIS art. 65. La edad se congela en vez de recalcularse al imprimir: dentro
 * de un año ya no sería la misma, y la reimpresión debe mostrar lo que decía
 * el papel que se entregó.
 */
export interface PacienteReceta {
  nombre: string;
  edad: number;
  sexo: SexoPaciente;
}

/**
 * Un medicamento prescrito. Los datos del RIS art. 29 son campos SEPARADOS y
 * no un texto libre: es lo que permite validarlos uno por uno y decirle al
 * médico exactamente cuál le falta, en vez de aceptar un párrafo que puede o
 * no traerlos.
 */
export interface MedicamentoRecetado {
  /** Clave del catálogo, o null si se capturó a mano (escape hatch). */
  clave: string | null;
  /** Obligatoria — la sustancia activa (RIS art. 28). */
  denominacionGenerica: string;
  /**
   * Marca comercial. Opcional por diseño de la norma: si se escribe, el
   * farmacéutico puede surtir igualmente el genérico.
   */
  denominacionDistintiva: string | null;
  presentacion: string;
  dosis: string; // '500 mg', '1 tableta'
  via: string; // ViaAdministracion, o libre si viene de texto libre
  frecuencia: string; // 'cada 8 horas'
  duracion: string; // 'por 7 días'
  indicaciones: string | null;
  /**
   * Fracción con la que se emitió, copiada del catálogo. Se congela: si la
   * sustancia se recataloga después, esta receta debe seguir explicando bajo
   * qué régimen se emitió. null = capturado como texto libre, donde el sistema
   * no puede afirmar la fracción.
   */
  fraccion: number | null;
}

export interface RecetaContent {
  emisor: EmisorReceta;
  paciente: PacienteReceta;
  diagnosticos: DiagnosticoCie10[];
  medicamentos: MedicamentoRecetado[];
  indicacionesGenerales: string | null;
  /**
   * Alergias vigentes al emitir. Se imprimen en la hoja: es una salvaguarda
   * para quien surta y para quien administre, no un adorno.
   */
  alergiasSnapshot: string[];
}

export interface CancelacionReceta {
  motivo: string;
  canceladoPorNombre: string;
  fecha: string;
}

export interface RecetaView {
  id: string;
  patientId: string;
  appointmentId: string | null;
  doctorId: string;
  /** Consecutivo por clínica: 'RX-2026-000123'. */
  folio: string;
  contenido: RecetaContent;
  /** null = vigente. La receta en sí es inmutable (ver 0028_recetas.sql). */
  cancelacion: CancelacionReceta | null;
  createdAt: string;
}

/**
 * `RecetaView` + lo que solo la hoja impresa necesita. El contenido ya trae el
 * snapshot del emisor y del paciente, así que esto agrega únicamente el nombre
 * ACTUAL del paciente, para el encabezado de navegación de la pantalla — que
 * no es el documento y sí debe reflejar la corrección de un nombre mal
 * capturado.
 */
export interface RecetaDetalle extends RecetaView {
  patientNombre: string;
}

export interface EmitirRecetaRequest {
  patientId: string;
  appointmentId?: string;
  diagnosticos: DiagnosticoCie10[];
  medicamentos: MedicamentoRecetado[];
  indicacionesGenerales?: string;
}

export interface CancelarRecetaRequest {
  motivo: string;
}

/** Un ítem vacío para arrancar la fila de captura en la UI. */
export const MEDICAMENTO_RECETADO_VACIO: MedicamentoRecetado = {
  clave: null,
  denominacionGenerica: '',
  denominacionDistintiva: null,
  presentacion: '',
  dosis: '',
  via: '',
  frecuencia: '',
  duracion: '',
  indicaciones: null,
  fraccion: null,
};
