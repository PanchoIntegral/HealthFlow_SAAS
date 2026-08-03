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
export interface Patient {
  id: string;
  tenantId: string;
  nombre: string;
  fechaNacimiento: string; // ISO date (YYYY-MM-DD)
  curp: string | null;
  telefono: string | null;
}

/** Datos para dar de alta un paciente (el tenant lo asigna el backend). */
export interface CreatePatientRequest {
  nombre: string;
  fechaNacimiento: string; // ISO date (YYYY-MM-DD)
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
}

export function banderaPorKey(key: string): BanderaClinica | undefined {
  return BANDERAS_CLINICAS.find((b) => b.key === key);
}

/** Resultado del buscador de pacientes. */
export interface PatientSummary {
  id: string;
  nombre: string;
  edad: number;
  curp: string | null;
  telefono: string | null;
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
  /** El servidor emite esto cuando una cita cambia de estado. */
  APPOINTMENT_UPDATED: 'appointment.updated',
} as const;

export interface AppointmentUpdatedEvent {
  entry: WaitingRoomEntry;
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

/** Perfil propio del usuario autenticado (GET /users/me). */
export interface UserProfile {
  id: string;
  nombre: string;
  rol: UserRole;
  /** Etiqueta libre mostrada en el selector de agenda (p.ej. "Cardiología intervencionista"). */
  especialidad: string | null;
  /** Clave del catálogo PERFILES: personaliza campos, etiquetas y signos vitales de la nota. */
  especialidadKey: EspecialidadKey;
}

export interface UpdateEspecialidadRequest {
  especialidadKey: EspecialidadKey;
  especialidad?: string;
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
  tipoNota: 'nota_evolucion';
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

export interface ClinicalNoteView {
  id: string;
  appointmentId: string;
  doctorId: string;
  tipoNota: ClinicalNoteType;
  estatus: ClinicalNoteStatus;
  contenido: NotaEvolucionContent;
  cerradoEn: string | null;
  createdAt: string;
}

export interface ClinicalRecordView {
  recordId: string;
  patientId: string;
  patientNombre: string;
  abiertoEn: string;
  notas: ClinicalNoteView[];
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
  tipo: 'texto' | 'texto-rico' | 'numero' | 'seleccion';
  opciones?: readonly string[];
  unidad?: string;
  /** Si es true, el cierre de la nota lo exige (además de la base NOM-004). */
  obligatorio?: boolean;
  ayuda?: string;
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
    camposExtra: [],
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
      { key: 'ped_perimetro_cefalico', label: 'Perímetro cefálico', tipo: 'numero', unidad: 'cm' },
      { key: 'ped_percentil_peso', label: 'Percentil de peso', tipo: 'numero', unidad: '%' },
      { key: 'ped_percentil_talla', label: 'Percentil de talla', tipo: 'numero', unidad: '%' },
      {
        key: 'ped_esquema_vacunacion',
        label: 'Esquema de vacunación',
        tipo: 'seleccion',
        opciones: ['Completo para la edad', 'Incompleto', 'Se desconoce'],
        obligatorio: true,
      },
      { key: 'ped_desarrollo', label: 'Desarrollo psicomotor', tipo: 'texto-rico' },
      { key: 'ped_alimentacion', label: 'Alimentación', tipo: 'texto' },
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
      { key: 'gin_fum', label: 'Fecha de última menstruación', tipo: 'texto' },
      { key: 'gin_gestas', label: 'Gestas', tipo: 'numero' },
      { key: 'gin_partos', label: 'Partos', tipo: 'numero' },
      { key: 'gin_cesareas', label: 'Cesáreas', tipo: 'numero' },
      { key: 'gin_abortos', label: 'Abortos', tipo: 'numero' },
      { key: 'gin_sdg', label: 'Semanas de gestación', tipo: 'numero', unidad: 'SDG' },
      { key: 'gin_metodo_planificacion', label: 'Método de planificación', tipo: 'texto' },
    ],
  },

  medicina_interna: {
    key: 'medicina_interna',
    nombre: 'Medicina interna',
    rangosCie10: [],
    signosVitales: VITALES_COMPLETOS,
    camposExtra: [
      { key: 'mi_comorbilidades', label: 'Comorbilidades', tipo: 'texto-rico' },
      { key: 'mi_medicacion_cronica', label: 'Medicación crónica actual', tipo: 'texto-rico' },
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
      { key: 'tra_region', label: 'Región anatómica', tipo: 'texto', obligatorio: true },
      {
        key: 'tra_lateralidad',
        label: 'Lateralidad',
        tipo: 'seleccion',
        opciones: ['Derecha', 'Izquierda', 'Bilateral', 'No aplica'],
      },
      { key: 'tra_arcos_movilidad', label: 'Arcos de movilidad', tipo: 'texto' },
      { key: 'tra_estudios_imagen', label: 'Estudios de imagen', tipo: 'texto-rico' },
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
      { key: 'der_topografia', label: 'Topografía de la lesión', tipo: 'texto', obligatorio: true },
      { key: 'der_morfologia', label: 'Morfología', tipo: 'texto' },
      { key: 'der_fototipo', label: 'Fototipo (Fitzpatrick)', tipo: 'seleccion', opciones: ['I', 'II', 'III', 'IV', 'V', 'VI'] },
      { key: 'der_dermatoscopia', label: 'Dermatoscopia', tipo: 'texto-rico' },
    ],
  },

  cardiologia: {
    key: 'cardiologia',
    nombre: 'Cardiología',
    rangosCie10: [{ desde: 'I00', hasta: 'I99' }],
    signosVitales: VITALES_COMPLETOS,
    camposExtra: [
      {
        key: 'car_clase_funcional',
        label: 'Clase funcional (NYHA)',
        tipo: 'seleccion',
        opciones: ['I', 'II', 'III', 'IV'],
      },
      { key: 'car_ta_brazo_der', label: 'T/A brazo derecho', tipo: 'texto' },
      { key: 'car_ta_brazo_izq', label: 'T/A brazo izquierdo', tipo: 'texto' },
      { key: 'car_ecg', label: 'Electrocardiograma', tipo: 'texto-rico' },
      { key: 'car_riesgo', label: 'Factores de riesgo cardiovascular', tipo: 'texto-rico' },
    ],
  },

  oftalmologia: {
    key: 'oftalmologia',
    nombre: 'Oftalmología',
    rangosCie10: [{ desde: 'H00', hasta: 'H59' }],
    signosVitales: ['ta', 'fc'],
    camposExtra: [
      { key: 'oft_agudeza_od', label: 'Agudeza visual OD', tipo: 'texto', obligatorio: true },
      { key: 'oft_agudeza_oi', label: 'Agudeza visual OI', tipo: 'texto', obligatorio: true },
      { key: 'oft_presion_od', label: 'Presión intraocular OD', tipo: 'numero', unidad: 'mmHg' },
      { key: 'oft_presion_oi', label: 'Presión intraocular OI', tipo: 'numero', unidad: 'mmHg' },
      { key: 'oft_segmento_anterior', label: 'Segmento anterior', tipo: 'texto-rico' },
      { key: 'oft_fondo_ojo', label: 'Fondo de ojo', tipo: 'texto-rico' },
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
      { key: 'orl_otoscopia', label: 'Otoscopia', tipo: 'texto-rico' },
      { key: 'orl_rinoscopia', label: 'Rinoscopia', tipo: 'texto-rico' },
      { key: 'orl_faringe', label: 'Orofaringe', tipo: 'texto' },
      { key: 'orl_audiometria', label: 'Audiometría', tipo: 'texto-rico' },
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
      { key: 'psi_examen_mental', label: 'Examen mental', tipo: 'texto-rico', obligatorio: true },
      {
        key: 'psi_riesgo_suicida',
        label: 'Riesgo suicida',
        tipo: 'seleccion',
        opciones: ['Ausente', 'Leve', 'Moderado', 'Alto'],
        obligatorio: true,
        ayuda: 'Su registro en cada consulta es un respaldo médico-legal.',
      },
      { key: 'psi_adherencia', label: 'Adherencia al tratamiento', tipo: 'texto' },
    ],
  },

  endocrinologia: {
    key: 'endocrinologia',
    nombre: 'Endocrinología',
    rangosCie10: [{ desde: 'E00', hasta: 'E90' }],
    signosVitales: VITALES_COMPLETOS,
    camposExtra: [
      { key: 'end_imc', label: 'IMC', tipo: 'numero', unidad: 'kg/m²' },
      { key: 'end_circunferencia_cintura', label: 'Circunferencia de cintura', tipo: 'numero', unidad: 'cm' },
      { key: 'end_glucosa', label: 'Glucosa', tipo: 'numero', unidad: 'mg/dL' },
      { key: 'end_hba1c', label: 'HbA1c', tipo: 'numero', unidad: '%' },
      { key: 'end_pies_diabeticos', label: 'Exploración de pies', tipo: 'texto' },
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
      { key: 'nut_imc', label: 'IMC', tipo: 'numero', unidad: 'kg/m²' },
      { key: 'nut_porcentaje_grasa', label: 'Porcentaje de grasa', tipo: 'numero', unidad: '%' },
      { key: 'nut_masa_muscular', label: 'Masa muscular', tipo: 'numero', unidad: 'kg' },
      { key: 'nut_circunferencia_cintura', label: 'Circunferencia de cintura', tipo: 'numero', unidad: 'cm' },
      { key: 'nut_recordatorio_24h', label: 'Recordatorio de 24 horas', tipo: 'texto-rico' },
      { key: 'nut_objetivo', label: 'Objetivo del paciente', tipo: 'texto' },
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
