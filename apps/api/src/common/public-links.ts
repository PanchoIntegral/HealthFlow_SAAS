import { createHash, createHmac } from 'node:crypto';
import { env } from '../config/env';

/** Los enlaces públicos dejan de funcionar 24 h después de terminar la cita. */
export const PUBLIC_MANAGE_LINK_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * El token es determinista por clínica y cita: API y worker pueden construir
 * el mismo enlace sin guardar el secreto ni el token en texto plano.
 */
export function publicAppointmentToken(tenantId: string, appointmentId: string): string {
  return createHmac('sha256', env.publicLinkSecret)
    .update(`${tenantId}.${appointmentId}`)
    .digest('base64url');
}

export function publicAppointmentTokenHash(tenantId: string, appointmentId: string): string {
  return createHash('sha256').update(publicAppointmentToken(tenantId, appointmentId)).digest('hex');
}

export function publicAppointmentTokenExpiry(endsAt: Date): Date {
  return new Date(endsAt.getTime() + PUBLIC_MANAGE_LINK_TTL_MS);
}
