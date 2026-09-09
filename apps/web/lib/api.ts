import type {
  AppointmentView,
  CancelAppointmentRequest,
  CancelarFacturaRequest,
  FacturacionView,
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
  AbrirCajaRequest,
  ActualizarCuentaRequest,
  ActualizarDatosClinicaRequest,
  ActualizarMovimientoCajaRequest,
  CerrarCajaRequest,
  RegistrarMovimientoCajaRequest,
  TurnoCajaResumen,
  TurnoCajaView,
  ChangePasswordRequest,
  ConfirmLogoRequest,
  ConfirmRadiografiaRequest,
  CrearCuentaRequest,
  CuentasResumen,
  CuentaView,
  DatosClinicaView,
  LogoClinicaView,
  RequestLogoUploadUrlRequest,
  RequestLogoUploadUrlResponse,
  ConsentimientoView,
  CorreccionNota,
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
  OrdenPlantillasContent,
  OrdenPlantillasDetalle,
  OrdenPlantillasView,
  PatientDirectoryPage,
  PatientSummary,
  ReportsStats,
  StartConsultationResponse,
  TimbrarFacturaRequest,
  TranscribirConsultaResponse,
  UpdatePerfilRequest,
  UserProfile,
  UserProfileMe,
  WaitingRoomEntry,
  MedicamentoCatalogo,
  RecetaView,
  RecetaDetalle,
  EmitirRecetaRequest,
  CancelarRecetaRequest,
  UpdatePatientRequest,
  AvailabilitySlot,
  BookingMetrics,
  BookingService,
  BookingReadiness, BookingSettings,
  CreatePublicAppointmentRequest,
  MessagingDelivery,
  PublicAppointmentSummary,
  PublicBookingPage,
} from '@healthflow/shared-types';
import { API_URL } from './config';
import { marcarAlCorriente, marcarSuspendida } from './suscripcion';

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
    // La suscripción venció: la cuenta quedó en solo lectura. No se redirige
    // (a diferencia del 401) porque consultar sí funciona — solo se levanta
    // el aviso global para que el usuario sepa por qué no pudo guardar.
    if (res.status === 402 && body.error === 'SuscripcionSuspendida') {
      marcarSuspendida();
    }
    throw new ApiError(res.status, body.message ?? res.statusText, body);
  }
  // Una escritura que pasó significa que la suscripción está al corriente:
  // es como se baja el aviso tras pagar, sin necesidad de recargar.
  if (rest.method && rest.method !== 'GET') marcarAlCorriente();
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
  publicBooking: (slug: string) => request<PublicBookingPage>(`/public/booking/${encodeURIComponent(slug)}`),
  publicAvailability: (slug:string,serviceId:string,doctorId:string|undefined,from:string,to:string) => request<AvailabilitySlot[]>(`/public/booking/${encodeURIComponent(slug)}/availability?serviceId=${encodeURIComponent(serviceId)}${doctorId?`&doctorId=${encodeURIComponent(doctorId)}`:''}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  createPublicAppointment: (slug:string,body:CreatePublicAppointmentRequest) => request<PublicAppointmentSummary>(`/public/booking/${encodeURIComponent(slug)}/appointments`,{method:'POST',body:JSON.stringify(body)}),
  publicAppointment: (manageToken:string) => request<PublicAppointmentSummary>(`/public/appointments/${encodeURIComponent(manageToken)}`),
  confirmPublicAppointment: (manageToken:string) => request<PublicAppointmentSummary>(`/public/appointments/${encodeURIComponent(manageToken)}/confirm`,{method:'POST'}),
  cancelPublicAppointment: (manageToken:string) => request<PublicAppointmentSummary>(`/public/appointments/${encodeURIComponent(manageToken)}/cancel`,{method:'POST'}),
  reschedulePublicAppointment: (manageToken:string,start:string,doctorId?:string) => request<PublicAppointmentSummary>(`/public/appointments/${encodeURIComponent(manageToken)}/reschedule`,{method:'POST',body:JSON.stringify({start,doctorId})}),
  bookingSettings: (token:string) => request<BookingSettings>('/booking/settings',{token}),
  bookingReadiness: (token:string) => request<BookingReadiness>('/booking/readiness',{token}),
  updateBookingSettings: (token:string,body:BookingSettings) => request<BookingSettings>('/booking/settings',{method:'PUT',token,body:JSON.stringify(body)}),
  bookingServices: (token:string) => request<BookingService[]>('/booking/services',{token}),
  createBookingService: (token:string,body:Omit<BookingService,'id'>) => request<BookingService>('/booking/services',{method:'POST',token,body:JSON.stringify(body)}),
  updateBookingService: (token:string,id:string,body:Omit<BookingService,'id'>) => request<BookingService>(`/booking/services/${id}`,{method:'PUT',token,body:JSON.stringify(body)}),
  bookingAvailabilityRules: (token:string) => request<{doctor_id:string;weekday:number;inicio_local:string;fin_local:string}[]>('/booking/availability',{token}),
  replaceBookingAvailability: (token:string,doctorId:string,rules:{weekday:number;inicioLocal:string;finLocal:string}[]) => request<{ok:true}>(`/booking/doctors/${doctorId}/availability`,{method:'PUT',token,body:JSON.stringify({rules})}),
  createBookingException: (token:string,body:{doctorId:string;fecha:string;disponible:boolean;nota?:string}) => request<{id:string}>('/booking/exceptions',{method:'POST',token,body:JSON.stringify(body)}),
  messagingDeliveries: (token:string) => request<MessagingDelivery[]>('/messaging/deliveries',{token}),
  bookingMetrics: (token:string) => request<BookingMetrics>('/messaging/metrics',{token}),
  retryDelivery: (token:string,id:string) => request<{ok:true}>(`/messaging/deliveries/${id}/retry`,{method:'POST',token}),
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

  /**
   * Abre el portal de facturación de Stripe (actualizar tarjeta, ver
   * facturas, cancelar). Funciona aun con la suscripción vencida: es
   * justamente como se deja de estarlo.
   */
  portalSession: (token: string) =>
    request<{ url: string }>('/subscriptions/portal-session', { method: 'POST', token }),

  /**
   * Plan, tarjeta e historial de cobros. Solo responde al titular (el resto
   * recibe 403), así que quien la llame debe estar preparado para ese caso.
   */
  facturacion: (token: string) =>
    request<FacturacionView>('/subscriptions/facturacion', { token }),

  waitingRoom: (token: string) =>
    request<WaitingRoomEntry[]>('/appointments/waiting-room', { token }),

  notifications: (token: string) => request<NotificationView[]>('/notifications', { token }),

  markNotificationRead: (token: string, id: string) =>
    request<void>(`/notifications/${id}/leer`, { method: 'POST', token }),

  markAllNotificationsRead: (token: string) =>
    request<void>('/notifications/leer-todas', { method: 'POST', token }),

  buscarCie10: (token: string, q: string) =>
    request<DiagnosticoCie10[]>(`/catalogos/cie10?q=${encodeURIComponent(q)}`, { token }),

  buscarMedicamentos: (token: string, q: string) =>
    request<MedicamentoCatalogo[]>(`/catalogos/medicamentos?q=${encodeURIComponent(q)}`, { token }),

  // ── Recetas ────────────────────────────────────────────────────
  listarRecetas: (token: string, patientId: string) =>
    request<RecetaView[]>(`/recetas?patientId=${patientId}`, { token }),

  getReceta: (token: string, id: string) => request<RecetaDetalle>(`/recetas/${id}`, { token }),

  emitirReceta: (token: string, body: EmitirRecetaRequest) =>
    request<RecetaView>('/recetas', { method: 'POST', token, body: JSON.stringify(body) }),

  cancelarReceta: (token: string, id: string, body: CancelarRecetaRequest) =>
    request<{ ok: true }>(`/recetas/${id}/cancelar`, {
      method: 'POST',
      token,
      body: JSON.stringify(body),
    }),

  checkIn: (token: string, appointmentId: string) =>
    request<WaitingRoomEntry>(`/appointments/${appointmentId}/check-in`, {
      method: 'POST',
      token,
    }),

  /**
   * Una página del directorio/buscador. `cursor` sale del `nextCursor` de la
   * respuesta anterior; omitirlo pide la primera.
   */
  searchPatients: (token: string, q: string, cursor?: string | null, limit?: number) => {
    const params = new URLSearchParams({ q });
    if (cursor) params.set('cursor', cursor);
    if (limit !== undefined) params.set('limit', String(limit));
    return request<PatientDirectoryPage>(`/patients?${params}`, { token });
  },

  updatePatient: (token: string, id: string, body: UpdatePatientRequest) =>
    request<PatientSummary>(`/patients/${id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify(body),
    }),

  archivarPaciente: (token: string, id: string) =>
    request<{ ok: true }>(`/patients/${id}/archivar`, { method: 'POST', token }),

  reactivarPaciente: (token: string, id: string) =>
    request<{ ok: true }>(`/patients/${id}/reactivar`, { method: 'POST', token }),

  eliminarPaciente: (token: string, id: string) =>
    request<void>(`/patients/${id}`, { method: 'DELETE', token }),

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

  /**
   * Agrega una corrección a una nota ya cerrada. No edita la nota: la NOM-004
   * prohíbe enmendaduras, así que la aclaración se guarda al lado, firmada.
   */
  corregirNota: (token: string, noteId: string, texto: string) =>
    request<CorreccionNota>(`/notas/${noteId}/correcciones`, {
      method: 'POST',
      token,
      body: JSON.stringify({ texto }),
    }),

  /** Abre (o CREA) la orden de plantillas de esta consulta. Solo esta llamada necesita el appointmentId. */
  getOrCreateOrdenPlantillas: (token: string, appointmentId: string) =>
    request<OrdenPlantillasView>(`/consultations/${appointmentId}/orden-plantillas`, { token }),

  /** Todas las órdenes de plantillas de un paciente, para el expediente. */
  listarOrdenesPlantillas: (token: string, patientId: string) =>
    request<OrdenPlantillasView[]>(`/ordenes-plantillas?patientId=${patientId}`, { token }),

  /** Detalle con nombres (paciente, médico, clínica), para la vista de impresión. */
  getOrdenPlantillasDetalle: (token: string, id: string) =>
    request<OrdenPlantillasDetalle>(`/ordenes-plantillas/${id}`, { token }),

  /**
   * Autosave por el id de la orden — funciona igual se haya abierto desde la
   * consulta o desde el expediente del paciente, una vez que se conoce el id.
   */
  saveOrdenPlantillasDraft: (token: string, ordenId: string, contenido: OrdenPlantillasContent) =>
    request<{ ok: true }>(`/ordenes-plantillas/${ordenId}`, {
      method: 'PUT',
      token,
      body: JSON.stringify({ contenido }),
    }),

  marcarOrdenPlantillasCompletada: (token: string, ordenId: string) =>
    request<{ ok: true }>(`/ordenes-plantillas/${ordenId}/marcar-completada`, {
      method: 'POST',
      token,
    }),

  /**
   * Expediente con una página del historial. `cursor` viene del `nextCursor`
   * de la página anterior; `limit` sirve para las vistas que solo necesitan
   * las últimas consultas y no el expediente entero.
   */
  getClinicalRecord: (
    token: string,
    patientId: string,
    page: { limit?: number; cursor?: string } = {},
  ) => {
    const qs = new URLSearchParams();
    if (page.limit !== undefined) qs.set('limit', String(page.limit));
    if (page.cursor) qs.set('cursor', page.cursor);
    const sufijo = qs.toString() ? `?${qs}` : '';
    return request<ClinicalRecordView>(`/patients/${patientId}/clinical-record${sufijo}`, { token });
  },

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

  // ── Caja ───────────────────────────────────────────────────────
  /** `null` cuando la caja del día todavía no se abre. */
  cajaAbierta: (token: string) => request<TurnoCajaView | null>('/caja/abierta', { token }),

  abrirCaja: (token: string, body: AbrirCajaRequest) =>
    request<TurnoCajaView>('/caja/abrir', { method: 'POST', token, body: JSON.stringify(body) }),

  cerrarCaja: (token: string, body: CerrarCajaRequest) =>
    request<TurnoCajaView>('/caja/cerrar', { method: 'POST', token, body: JSON.stringify(body) }),

  registrarMovimientoCaja: (token: string, body: RegistrarMovimientoCajaRequest) =>
    request<TurnoCajaView>('/caja/movimientos', {
      method: 'POST',
      token,
      body: JSON.stringify(body),
    }),

  actualizarMovimientoCaja: (
    token: string,
    id: string,
    body: ActualizarMovimientoCajaRequest,
  ) =>
    request<TurnoCajaView>(`/caja/movimientos/${id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify(body),
    }),

  cancelarMovimientoCaja: (token: string, id: string, motivo: string) =>
    request<TurnoCajaView>(`/caja/movimientos/${id}/cancelar`, {
      method: 'POST',
      token,
      body: JSON.stringify({ motivo }),
    }),

  /** Histórico de cortes. Sin rango, los últimos turnos del consultorio. */
  listarCortes: (token: string, rango?: { desde?: string; hasta?: string }) => {
    const qs = new URLSearchParams();
    if (rango?.desde) qs.set('desde', rango.desde);
    if (rango?.hasta) qs.set('hasta', rango.hasta);
    return request<TurnoCajaResumen[]>(`/caja/turnos${qs.toString() ? `?${qs}` : ''}`, { token });
  },

  corteDeCaja: (token: string, turnoId: string) =>
    request<TurnoCajaView>(`/caja/turnos/${turnoId}`, { token }),

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

  /** Trae también `suscripcion`: es la lectura de la que vive el banner. */
  getMyProfile: (token: string) => request<UserProfileMe>('/users/me', { token }),

  /**
   * Manda el audio de la consulta a transcribir. No usa `request()` porque el
   * cuerpo es multipart: el navegador tiene que poner él mismo el
   * Content-Type con su boundary, y fijarlo a mano rompe la petición.
   */
  transcribirIa: async (
    token: string,
    appointmentId: string,
    audio: Blob,
    camposYaLlenados: NotaEvolucionContent,
  ): Promise<TranscribirConsultaResponse> => {
    const form = new FormData();
    // La extensión importa poco; el mime del Blob es lo que el API valida.
    form.append('audio', audio, 'consulta.webm');
    form.append('camposYaLlenados', JSON.stringify(camposYaLlenados));

    const res = await fetch(`${API_URL}/api/consultations/${appointmentId}/transcribir-ia`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.message ?? res.statusText, body);
    }
    return res.json() as Promise<TranscribirConsultaResponse>;
  },

  // ── Cuentas del equipo (solo el titular) ──
  cuentas: (token: string) => request<CuentasResumen>('/cuentas', { token }),

  crearCuenta: (token: string, body: CrearCuentaRequest) =>
    request<CuentaView>('/cuentas', { method: 'POST', token, body: JSON.stringify(body) }),

  cambiarEstadoCuenta: (token: string, cuentaId: string, body: ActualizarCuentaRequest) =>
    request<CuentaView>(`/cuentas/${cuentaId}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify(body),
    }),

  /** Dirección, teléfono y leyenda de la clínica, para documentos impresos. Solo titular. */
  actualizarDatosClinica: (token: string, body: ActualizarDatosClinicaRequest) =>
    request<{ direccion: string | null; telefono: string | null }>('/cuentas/clinica', {
      method: 'PATCH',
      token,
      body: JSON.stringify(body),
    }),

  /** Dirección, teléfono, logo (URL firmada) y leyenda de pie. Solo titular. */
  obtenerDatosClinica: (token: string) => request<DatosClinicaView>('/cuentas/clinica', { token }),

  requestLogoUploadUrl: (token: string, body: RequestLogoUploadUrlRequest) =>
    request<RequestLogoUploadUrlResponse>('/cuentas/clinica/logo/upload-url', {
      method: 'POST',
      token,
      body: JSON.stringify(body),
    }),

  confirmLogo: (token: string, body: ConfirmLogoRequest) =>
    request<LogoClinicaView>('/cuentas/clinica/logo', {
      method: 'POST',
      token,
      body: JSON.stringify(body),
    }),

  eliminarLogo: (token: string) =>
    request<void>('/cuentas/clinica/logo', { method: 'DELETE', token }),

  /** Especialidad + cédula profesional (la que se estampa al firmar la nota). */
  updatePerfil: (token: string, body: UpdatePerfilRequest) =>
    request<UserProfile>('/users/me/perfil', {
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
