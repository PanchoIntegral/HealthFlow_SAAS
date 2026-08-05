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
  HistorialPaciente,
  UpdateHistorialRequest,
  ChangePasswordRequest,
  ConfirmRadiografiaRequest,
  ConsentimientoView,
  CrearConsentimientoRequest,
  CrearPresupuestoRequest,
  EstatusPartida,
  EstatusPresupuesto,
  NuevaPartida,
  PresupuestoView,
  RadiografiaView,
  RegistrarAbonoRequest,
  RequestUploadUrlRequest,
  RequestUploadUrlResponse,
  SaldosPorCobrar,
  LoginRequest,
  LoginResponse,
  NotaEvolucionContent,
  NotificationView,
  PatientSummary,
  ReportsStats,
  StartConsultationResponse,
  TimbrarFacturaRequest,
  UpdateEspecialidadRequest,
  UserProfile,
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

  forgotPassword: (email: string) =>
    request<{ ok: true }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),

  resetPassword: (token: string, newPassword: string) =>
    request<LoginResponse>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    }),

  changePassword: (token: string, body: ChangePasswordRequest) =>
    request<{ ok: true }>('/users/me/password', { method: 'PATCH', token, body: JSON.stringify(body) }),

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

  // ── Presupuestos ───────────────────────────────────────────────
  listarPresupuestos: (token: string, patientId: string) =>
    request<PresupuestoView[]>(`/presupuestos?patientId=${patientId}`, { token }),

  /** Todos los presupuestos del consultorio (tablero), opcionalmente filtrados por estatus. */
  listarTodosPresupuestos: (token: string, estatus?: EstatusPresupuesto[]) =>
    request<PresupuestoView[]>(
      `/presupuestos${estatus && estatus.length > 0 ? `?estatus=${estatus.join(',')}` : ''}`,
      { token },
    ),

  crearPresupuesto: (token: string, body: CrearPresupuestoRequest) =>
    request<PresupuestoView>('/presupuestos', { method: 'POST', token, body: JSON.stringify(body) }),

  reemplazarPartidas: (token: string, id: string, partidas: NuevaPartida[]) =>
    request<PresupuestoView>(`/presupuestos/${id}/partidas`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ partidas }),
    }),

  cambiarEstatusPresupuesto: (token: string, id: string, estatus: EstatusPresupuesto) =>
    request<PresupuestoView>(`/presupuestos/${id}/estatus`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ estatus }),
    }),

  cambiarEstatusPartida: (
    token: string,
    id: string,
    partidaId: string,
    estatus: EstatusPartida,
    appointmentId?: string,
  ) =>
    request<PresupuestoView>(`/presupuestos/${id}/partidas/${partidaId}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ estatus, appointmentId }),
    }),

  registrarAbono: (token: string, id: string, body: RegistrarAbonoRequest) =>
    request<PresupuestoView>(`/presupuestos/${id}/abonos`, {
      method: 'POST',
      token,
      body: JSON.stringify(body),
    }),

  saldosPorCobrar: (token: string) => request<SaldosPorCobrar>('/presupuestos/saldos', { token }),

  // ── Consentimiento informado ─────────────────────────────────────
  listarConsentimientos: (token: string, patientId: string) =>
    request<ConsentimientoView[]>(`/consentimientos?patientId=${patientId}`, { token }),

  crearConsentimiento: (token: string, body: CrearConsentimientoRequest) =>
    request<ConsentimientoView>('/consentimientos', { method: 'POST', token, body: JSON.stringify(body) }),

  // ── Radiografías ──────────────────────────────────────────────────
  listarRadiografias: (token: string, patientId: string) =>
    request<RadiografiaView[]>(`/radiografias?patientId=${patientId}`, { token }),

  requestUploadUrl: (token: string, body: RequestUploadUrlRequest) =>
    request<RequestUploadUrlResponse>('/radiografias/upload-url', {
      method: 'POST',
      token,
      body: JSON.stringify(body),
    }),

  confirmRadiografia: (token: string, body: ConfirmRadiografiaRequest) =>
    request<RadiografiaView>('/radiografias', { method: 'POST', token, body: JSON.stringify(body) }),

  eliminarRadiografia: (token: string, id: string) =>
    request<void>(`/radiografias/${id}`, { method: 'DELETE', token }),

  /** Reemplazo completo de alergias y antecedentes del paciente. */
  updateHistorial: (token: string, patientId: string, historial: UpdateHistorialRequest) =>
    request<HistorialPaciente>(`/patients/${patientId}/historial`, {
      method: 'PATCH',
      token,
      body: JSON.stringify(historial),
    }),

  getMyProfile: (token: string) => request<UserProfile>('/users/me', { token }),

  updateEspecialidad: (token: string, body: UpdateEspecialidadRequest) =>
    request<UserProfile>('/users/me/especialidad', {
      method: 'PATCH',
      token,
      body: JSON.stringify(body),
    }),

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
