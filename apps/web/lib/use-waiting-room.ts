'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import {
  WAITING_ROOM_EVENTS,
  type AppointmentUpdatedEvent,
  type WaitingRoomEntry,
} from '@healthflow/shared-types';
import { api } from './api';
import { API_URL } from './config';

const QUERY_KEY = ['waiting-room'];

/**
 * Inserta o reemplaza la cita del evento manteniendo el orden por hora de
 * inicio que devuelve el servidor. Es un upsert porque `appointment.updated`
 * también anuncia ALTAS: una cita recién agendada para hoy todavía no está en
 * la lista y hay que darla de alta, no ignorarla.
 *
 * No hay bajas: una cita cancelada sigue apareciendo (columna de terminadas),
 * igual que la devolvería una recarga de la sala de espera.
 */
function upsertEntry(prev: WaitingRoomEntry[], entry: WaitingRoomEntry): WaitingRoomEntry[] {
  const i = prev.findIndex((e) => e.appointmentId === entry.appointmentId);
  if (i !== -1) return prev.map((e, j) => (j === i ? entry : e));

  const next = [...prev, entry];
  next.sort((a, b) => a.inicioProgramado.localeCompare(b.inicioProgramado));
  return next;
}

/**
 * Sala de espera en tiempo real: carga inicial con TanStack Query + suscripción
 * WebSocket. Al recibir un `appointment.updated`, actualiza la cache in-place
 * (sin refetch) para que la tarjeta aparezca o cambie de estado al instante.
 */
export function useWaitingRoom(token: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.waitingRoom(token),
    enabled: !!token,
  });

  useEffect(() => {
    if (!token) return;
    const socket: Socket = io(`${API_URL}/waiting-room`, {
      auth: { token },
      transports: ['websocket'],
    });

    socket.on(WAITING_ROOM_EVENTS.APPOINTMENT_UPDATED, (event: AppointmentUpdatedEvent) => {
      queryClient.setQueryData<WaitingRoomEntry[]>(QUERY_KEY, (prev) =>
        prev ? upsertEntry(prev, event.entry) : prev,
      );
    });

    return () => {
      socket.disconnect();
    };
  }, [token, queryClient]);

  return query;
}

export { QUERY_KEY as WAITING_ROOM_QUERY_KEY };
