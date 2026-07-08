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
 * Sala de espera en tiempo real: carga inicial con TanStack Query + suscripción
 * WebSocket. Al recibir un `appointment.updated`, actualiza la cache in-place
 * (sin refetch) para que la tarjeta cambie de estado al instante.
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
      queryClient.setQueryData<WaitingRoomEntry[]>(QUERY_KEY, (prev) => {
        if (!prev) return prev;
        return prev.map((e) =>
          e.appointmentId === event.entry.appointmentId ? event.entry : e,
        );
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [token, queryClient]);

  return query;
}

export { QUERY_KEY as WAITING_ROOM_QUERY_KEY };
