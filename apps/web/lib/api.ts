import type {
  ClinicalNoteView,
  ClinicalRecordView,
  CreatePatientRequest,
  DashboardStats,
  FinishConsultationResponse,
  LoginRequest,
  LoginResponse,
  NotaEvolucionContent,
  PatientSummary,
  StartConsultationResponse,
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
    throw new ApiError(res.status, body.message ?? res.statusText, body);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
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

  waitingRoom: (token: string) =>
    request<WaitingRoomEntry[]>('/appointments/waiting-room', { token }),

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
};
