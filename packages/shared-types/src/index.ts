/**
 * Contratos compartidos entre `apps/web` (Next.js) y `apps/api` (NestJS).
 * Definir la forma de las entidades UNA sola vez: si algo se desincroniza
 * entre frontend y backend, TypeScript marca el error en ambos lados.
 */

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
