import type {
  AppointmentView,
  CancelAppointmentRequest,
  CancelarFacturaRequest,
  FacturaView,
  FinanzasResumen,
  ClinicalNoteView,
  ClinicalRecordView,
  CreateAppointmentRequest,
  CreatePatientRequest,
  DashboardStats,
  DiagnosticoCie10,
  DoctorSummary,
  FinishConsultationResponse,
  LoginRequest,
  LoginResponse,
  NotaEvolucionContent,
  NotificationView,
  PatientSummary,
  ReportsStats,
  StartConsultationResponse,
  TimbrarFacturaRequest,
  WaitingRoomEntry,
} from '@healthflow/shared-types';
import { API_URL } from './config';

async function request<T>(
  path: string,
  options: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, headers, ...rest } = options;
  const res = await fetch(`${API_URL}/api${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) {
      // Sesión inválida o expirada (JWT vencido): limpiar y forzar re-login.
      localStorage.removeItem('healthflow.session');
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    throw new ApiError(res.status, body.message ?? res.statusText, body);
  }
  if (res.status === 204) return undefined as T;
  // Algunos endpoints responden 200 con body vacío para representar `null`
  // (p.ej. Express serializa un valor `null` de vuelta como respuesta sin
  // contenido). res.json() falla ahí, así que primero leemos como texto.
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export const api = {
  login: (body: LoginRequest) =>
    request<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),

  /** 200 = LoginResponse; 202 = { status: 'pending' } (el webhook aún no termina). */
  exchangeOnboardingTicket: (stripeSessionId: string) =>
    request<LoginResponse | { status: 'pending' }>('/auth/exchange-ticket', {
      method: 'POST',
      body: JSON.stringify({ stripeSessionId }),
    }),

  waitingRoom: (token: string) =>
    request<WaitingRoomEntry[]>('/appointments/waiting-room', { token }),

  notifications: (token: string) => request<NotificationView[]>('/notifications', { token }),

  markNotificationRead: (token: string, id: string) =>
    request<void>(`/notifications/${id}/leer`, { method: 'POST', token }),

  markAllNotificationsRead: (token: string) =>
    request<void>('/notifications/leer-todas', { method: 'POST', token }),

  buscarCie10: (token: string, q: string) =>
    request<DiagnosticoCie10[]>(`/catalogos/cie10?q=${encodeURIComponent(q)}`, { token }),

  checkIn: (token: string, appointmentId: string) =>
    request<WaitingRoomEntry>(`/appointments/${appointmentId}/check-in`, {
      method: 'POST',
      token,
    }),

  searchPatients: (token: string, q: string) =>
    request<PatientSummary[]>(`/patients?q=${encodeURIComponent(q)}`, { token }),

  createPatient: (token: string, body: CreatePatientRequest) =>
    request<PatientSummary>('/patients', {
      method: 'POST',
      token,
      body: JSON.stringify(body),
    }),

  startConsultation: (token: string, appointmentId: string) =>
    request<StartConsultationResponse>(`/appointments/${appointmentId}/start-consultation`, {
      method: 'POST',
      token,
    }),

  getConsultationNote: (token: string, appointmentId: string) =>
    request<ClinicalNoteView>(`/consultations/${appointmentId}/note`, { token }),

  saveNoteDraft: (token: string, appointmentId: string, contenido: NotaEvolucionContent) =>
    request<{ ok: true }>(`/consultations/${appointmentId}/note`, {
      method: 'PUT',
      token,
      body: JSON.stringify({ contenido }),
    }),

  finishConsultation: (token: string, appointmentId: string, contenido: NotaEvolucionContent) =>
    request<FinishConsultationResponse>(`/consultations/${appointmentId}/finish`, {
      method: 'POST',
      token,
      body: JSON.stringify({ contenido }),
    }),

  getClinicalRecord: (token: string, patientId: string) =>
    request<ClinicalRecordView>(`/patients/${patientId}/clinical-record`, { token }),

  dashboardStats: (token: string) =>
    request<DashboardStats>('/dashboard/stats', { token }),

  listDoctors: (token: string) =>
    request<DoctorSummary[]>('/appointments/doctors', { token }),

  listAppointments: (token: string, fromISO: string, toISO: string) =>
    request<AppointmentView[]>(
      `/appointments?from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`,
      { token },
    ),

  createAppointment: (token: string, body: CreateAppointmentRequest) =>
    request<AppointmentView>('/appointments', {
      method: 'POST',
      token,
      body: JSON.stringify(body),
    }),

  cancelAppointment: (token: string, appointmentId: string, body: CancelAppointmentRequest = {}) =>
    request<AppointmentView>(`/appointments/${appointmentId}/cancel`, {
      method: 'POST',
      token,
      body: JSON.stringify(body),
    }),

  reportsStats: (token: string) => request<ReportsStats>('/reports/stats', { token }),

  // ── Facturación (CFDI) ──
  getFacturaDeCita: (token: string, appointmentId: string) =>
    request<FacturaView | null>(`/billing/citas/${appointmentId}/factura`, { token }),

  timbrarFactura: (token: string, body: TimbrarFacturaRequest) =>
    request<FacturaView>('/billing/facturas', {
      method: 'POST',
      token,
      body: JSON.stringify(body),
    }),

  cancelarFactura: (token: string, facturaId: string, body: CancelarFacturaRequest) =>
    request<FacturaView>(`/billing/facturas/${facturaId}/cancelar`, {
      method: 'POST',
      token,
      body: JSON.stringify(body),
    }),

  finanzas: (token: string, mes?: string) =>
    request<FinanzasResumen>(`/billing/finanzas${mes ? `?mes=${mes}` : ''}`, { token }),
};
